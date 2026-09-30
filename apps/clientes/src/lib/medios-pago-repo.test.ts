import { describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

vi.mock("./tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));

const dbActual = { db: null as unknown };
vi.mock("@/db", () => ({ getDb: () => dbActual.db }));

import { leerMediosPago, leerMediosPagoTolerante } from "./medios-pago-repo";
import { leerMensajeConfirmacion, leerWhatsappSucursal } from "./contacto-pedido-repo";

/** Postgres: relación inexistente (42P01) / columna inexistente (42703), como sin la migración del CRM. */
const dbQueTira = (mensaje: string) => ({
  select: () => ({
    from: () => ({
      where: () => {
        const q: Promise<never> & { orderBy?: unknown; limit?: unknown } = Promise.reject(new Error(mensaje));
        q.catch(() => {});
        (q as { orderBy: unknown }).orderBy = () => Promise.reject(new Error(mensaje));
        (q as { limit: unknown }).limit = () => Promise.reject(new Error(mensaje));
        return q;
      },
    }),
  }),
});

describe("leerMediosPago", () => {
  it("pide sólo columnas declaradas, del tenant, ordenadas, contra public.medios_pago_shop", async () => {
    const g = dbGrabadora(() => [["efectivo", "Efectivo", "", true, true, false, false, 1]]);
    const r = await leerMediosPago(g.db as never);
    expect(r).toEqual([
      {
        slug: "efectivo",
        nombre: "Efectivo",
        instrucciones: "",
        activo: true,
        aplicaRetiro: true,
        aplicaEnvio: false,
        cobroOnline: false,
        orden: 1,
      },
    ]);
    const { sql, params } = g.consultas[0];
    expect(sql).toContain('"public"."medios_pago_shop"');
    expect(sql).toContain('"tenant_id" = $1');
    expect(sql).toContain("order by");
    expect(params).toContain("tenant-ejemplo");
  });

  it("tira si la tabla no existe (lo tolera la variante tolerante)", async () => {
    await expect(leerMediosPago(dbQueTira('relation "public.medios_pago_shop" does not exist') as never)).rejects.toThrow();
  });
});

describe("leerMediosPagoTolerante: la migración del CRM puede no estar aplicada", () => {
  it("tabla inexistente: devuelve [] (el checkout sigue con las opciones fijas)", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await leerMediosPagoTolerante(dbQueTira('relation "public.medios_pago_shop" does not exist') as never);
    expect(r).toEqual([]);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("permiso denegado: también []", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await leerMediosPagoTolerante(dbQueTira("permission denied for table medios_pago_shop") as never)).toEqual([]);
    aviso.mockRestore();
  });
});

describe("mensaje_confirmacion y WhatsApp: tolerantes a la migración ausente", () => {
  it("columna inexistente: mensaje vacío (texto por defecto), sin tirar", async () => {
    dbActual.db = dbQueTira('column "mensaje_confirmacion" does not exist');
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await leerMensajeConfirmacion()).toBe("");
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("con la columna presente devuelve el texto del operador", async () => {
    dbActual.db = dbGrabadora(() => [["Le responderemos dentro de {plazo}."]]).db;
    expect(await leerMensajeConfirmacion()).toBe("Le responderemos dentro de {plazo}.");
  });

  it("sin fila de reglas: vacío", async () => {
    dbActual.db = dbGrabadora(() => []).db;
    expect(await leerMensajeConfirmacion()).toBe("");
  });

  it("WhatsApp: null sin sucursal, sin consultar; el de la sucursal si existe; null si la lectura falla", async () => {
    const g = dbGrabadora(() => [["  +54 9 11 5555-0100 "]]);
    dbActual.db = g.db;
    expect(await leerWhatsappSucursal(null)).toBeNull();
    expect(g.consultas).toHaveLength(0);
    expect(await leerWhatsappSucursal("igz")).toBe("+54 9 11 5555-0100");
    expect(g.consultas[0].sql).toContain('"public"."sucursales"');
    expect(g.consultas[0].params).toEqual(expect.arrayContaining(["tenant-ejemplo", "igz"]));

    dbActual.db = dbQueTira("boom");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await leerWhatsappSucursal("igz")).toBeNull();
    err.mockRestore();
  });
});
