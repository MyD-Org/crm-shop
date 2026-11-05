import { describe, expect, it } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";
import {
  bajaPorToken,
  contarPendientesPorEmail,
  generarTokenBaja,
  insertarAviso,
  listarPendientesDe,
  marcarAvisado,
  marcarError,
  pendientesAgrupados,
  purgar,
  reclamarAviso,
} from "./aviso-reingreso-repo";

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

describe("consultas del cron (S2)", () => {
  it("pendientesAgrupados: distintos alegra_id del tenant, solo pendientes, con intentos y sin reclamo vigente", async () => {
    const g = dbGrabadora(() => [["P1"]]);
    expect(await pendientesAgrupados(g.db, "tenant-a")).toEqual(["P1"]);
    const [c] = g.consultas;
    expect(c.sql).toContain("select distinct");
    expect(c.sql).toContain('"avisos_reingreso"."tenant_id" = $');
    expect(c.sql).toContain('"avisado_at" is null');
    expect(c.sql).toContain('"unsubscribed_at" is null');
    expect(c.sql).toContain('"intentos" < $');
    expect(c.sql).toContain('"avisando_en" is null');
    expect(c.params).toEqual(expect.arrayContaining(["tenant-a", 5, 30]));
  });

  it("listarPendientesDe: por tenant y productos, más viejos primero, con límite; vacío no consulta", async () => {
    const g = dbGrabadora(() => []);
    await listarPendientesDe(g.db, "tenant-a", ["P1", "P2"], 200);
    const [c] = g.consultas;
    expect(c.sql).toContain('"alegra_id" in ($');
    expect(c.sql).toContain('order by "shop"."avisos_reingreso"."created_at" asc');
    expect(c.sql).toContain("limit $");
    await listarPendientesDe(g.db, "tenant-a", [], 200);
    expect(g.consultas).toHaveLength(1);
  });

  it("reclamarAviso: un UPDATE condicionado al tenant, al id y al estado pendiente", async () => {
    const g = dbGrabadora(() => [["x"]]);
    expect(await reclamarAviso(g.db, "tenant-a", "id-1")).toBe(true);
    const [c] = g.consultas;
    expect(c.sql).toContain('update "shop"."avisos_reingreso" set "avisando_en" = now()');
    expect(c.sql).toContain('"intentos" = "shop"."avisos_reingreso"."intentos" + 1');
    expect(c.sql).toContain('"tenant_id" = $');
    expect(c.sql).toContain('"avisado_at" is null');
    const g2 = dbGrabadora(() => []);
    expect(await reclamarAviso(g2.db, "tenant-a", "id-1")).toBe(false);
  });

  it("marcarAvisado y marcarError solo tocan avisos sin avisar del tenant; nunca setean avisado_at en el error", async () => {
    const g = dbGrabadora(() => []);
    await marcarAvisado(g.db, "tenant-a", "id-1");
    await marcarError(g.db, "tenant-a", "id-1", "No se pudo enviar el email");
    const [ok, mal] = g.consultas;
    expect(ok.sql).toContain('"avisado_at" = now()');
    expect(ok.sql).toContain('"email_error" = $');
    expect(mal.sql).not.toContain('"avisado_at" = now()');
    expect(mal.sql).toContain('"avisando_en" = $');
    for (const c of [ok, mal]) expect(c.sql).toContain('"tenant_id" = $');
  });

  it("bajaPorToken: UPDATE por tenant y token; token vacío o larguísimo no consulta", async () => {
    const g = dbGrabadora(() => [["x"]]);
    expect(await bajaPorToken(g.db, "tenant-a", "tok")).toBe(true);
    const [c] = g.consultas;
    expect(c.sql).toContain('"unsubscribed_at" = coalesce("shop"."avisos_reingreso"."unsubscribed_at", now())');
    expect(c.sql).toContain('"token_baja" = $');
    expect(await bajaPorToken(g.db, "tenant-a", "")).toBe(false);
    expect(await bajaPorToken(g.db, "tenant-a", "x".repeat(200))).toBe(false);
    expect(g.consultas).toHaveLength(1);
  });

  it("purgar: DELETE del tenant con 180 días para avisados y bajas, y 365 para pendientes", async () => {
    const g = dbGrabadora(() => [["a"], ["b"]]);
    expect(await purgar(g.db, "tenant-a")).toBe(2);
    const [c] = g.consultas;
    expect(c.sql).toContain('delete from "shop"."avisos_reingreso"');
    expect(c.sql).toContain('"tenant_id" = $');
    expect(c.params).toEqual(expect.arrayContaining([180, 365]));
  });
});
