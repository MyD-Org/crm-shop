import { describe, expect, it } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";
import { contarPendientesPorEmail, generarTokenBaja, insertarAviso } from "./aviso-reingreso-repo";

/**
 * Forma de las consultas sobre `shop.avisos_reingreso`: se corren las funciones reales contra un
 * cliente que graba el SQL. El comportamiento contra Postgres real (único parcial, aislamiento por
 * tenant) está en test/integration/aviso-reingreso.integration.test.ts.
 */

describe("generarTokenBaja", () => {
  it("32 bytes en base64url, distinto cada vez", () => {
    const a = generarTokenBaja();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generarTokenBaja()).not.toBe(a);
  });
});

describe("contarPendientesPorEmail", () => {
  it("filtra por tenant, email sin importar mayúsculas y solo pendientes", async () => {
    const g = dbGrabadora(() => [[3]]);
    expect(await contarPendientesPorEmail(g.db, "tenant-a", "Ana@Cliente.example")).toBe(3);
    const [c] = g.consultas;
    expect(c.sql).toContain('from "shop"."avisos_reingreso"');
    expect(c.sql).toContain('"avisos_reingreso"."tenant_id" = $');
    expect(c.sql).toContain('lower("shop"."avisos_reingreso"."email") = $');
    expect(c.sql).toContain('"avisos_reingreso"."avisado_at" is null');
    expect(c.sql).toContain('"avisos_reingreso"."unsubscribed_at" is null');
    expect(c.params).toEqual(expect.arrayContaining(["tenant-a", "ana@cliente.example"]));
  });
});

describe("insertarAviso", () => {
  it("inserta con tenant y token, sin IP ni user agent, con el ON CONFLICT del único parcial", async () => {
    const g = dbGrabadora(() => [["0b8f7d1e-7c55-4a38-9d0e-2c1f7f6b9a10", true]]);
    const r = await insertarAviso(g.db, {
      tenantId: "tenant-a",
      alegraId: "P1",
      email: "ana@cliente.example",
      whatsapp: null,
      cantidad: 2,
      quiereEncargar: false,
      consentimientoContacto: false,
      clerkUserId: null,
    });
    expect(r.creado).toBeDefined();
    const [c] = g.consultas;
    expect(c.sql).toContain('insert into "shop"."avisos_reingreso"');
    expect(c.sql).toContain('on conflict ("tenant_id", "alegra_id", lower("email")) where "avisado_at" is null and "unsubscribed_at" is null');
    expect(c.sql).not.toMatch(/\bip\b|user_agent/i);
    expect(c.params).toEqual(expect.arrayContaining(["tenant-a", "P1", "ana@cliente.example", 2]));
    // Último parámetro del VALUES: el token de baja.
    expect(c.params.some((p) => typeof p === "string" && /^[A-Za-z0-9_-]{43}$/.test(p))).toBe(true);
  });
});
