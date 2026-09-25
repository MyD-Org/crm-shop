import { describe, expect, it } from "vitest";
import { dbGrabadora, valoresInsertados } from "@/db/__fixtures__/db-grabadora";
import { contarRecientesPorEmail, insertarSolicitud, marcarEnvios } from "./arrepentimiento-repo";

/**
 * Forma de las consultas sobre `shop.solicitudes_arrepentimiento`: se corren
 * las funciones reales contra un cliente que graba el SQL.
 */

const ID = "0b8f7d1e-7c55-4a38-9d0e-2c1f7f6b9a10";

describe("contarRecientesPorEmail", () => {
  it("filtra por tenant, email y fecha desde", async () => {
    const g = dbGrabadora(() => [[2]]);
    const desde = new Date("2026-09-24T00:00:00Z");
    const n = await contarRecientesPorEmail(g.db, "tenant-a", "ana@cliente.example", desde);
    expect(n).toBe(2);
    const [c] = g.consultas;
    expect(c.sql).toContain('from "shop"."solicitudes_arrepentimiento"');
    expect(c.sql).toContain('"solicitudes_arrepentimiento"."tenant_id" = $');
    expect(c.sql).toContain('"solicitudes_arrepentimiento"."email" = $');
    expect(c.sql).toContain('"solicitudes_arrepentimiento"."created_at" >= $');
    expect(c.params).toEqual(expect.arrayContaining(["tenant-a", "ana@cliente.example", desde.toISOString()]));
  });

  it("sin filas cuenta 0", async () => {
    const g = dbGrabadora(() => []);
    expect(await contarRecientesPorEmail(g.db, "t", "a@cliente.example", new Date())).toBe(0);
  });
});

describe("insertarSolicitud", () => {
  it("inserta con tenant y sin IP ni user agent; devuelve id y número", async () => {
    const g = dbGrabadora(() => [[ID, 42]]);
    const r = await insertarSolicitud(g.db, {
      tenantId: "tenant-a",
      nombre: "Ana",
      email: "ana@cliente.example",
      telefono: "123",
      pedidoNumero: null,
      motivo: "No lo necesito",
    });
    expect(r).toEqual({ id: ID, numero: 42 });
    const [c] = g.consultas;
    expect(c.sql).toMatch(/^insert into "shop"\."solicitudes_arrepentimiento"/);
    expect(c.sql).toMatch(/returning "id", "numero"$/);
    const v = valoresInsertados(c);
    expect(v).toMatchObject({
      tenant_id: "tenant-a",
      nombre: "Ana",
      email: "ana@cliente.example",
      telefono: "123",
      pedido_numero: null,
      motivo: "No lo necesito",
    });
    expect(Object.keys(v).some((k) => /ip|agent/.test(k))).toBe(false);
  });
});

describe("marcarEnvios", () => {
  it("actualiza las tres columnas email_* de esa fila", async () => {
    const g = dbGrabadora();
    const cliente = new Date("2026-09-25T10:00:00Z");
    await marcarEnvios(g.db, ID, { clienteEn: cliente, comercioEn: null, error: "comercio: sin destinatario" });
    const [c] = g.consultas;
    expect(c.sql).toMatch(/^update "shop"\."solicitudes_arrepentimiento" set/);
    expect(c.sql).toContain('"email_cliente_enviado_en" = $');
    expect(c.sql).toContain('"email_comercio_enviado_en" = $');
    expect(c.sql).toContain('"email_error" = $');
    expect(c.sql).toContain('"solicitudes_arrepentimiento"."id" = $');
    expect(c.params).toEqual(expect.arrayContaining([cliente.toISOString(), null, "comercio: sin destinatario", ID]));
  });
});
