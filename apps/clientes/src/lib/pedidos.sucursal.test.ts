import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatosSucursales } from "./sucursales-repo";

/**
 * `crearPedido` con el flag `sucursales`: relee las reglas DENTRO de la transacción y congela
 * `sucursal`, `sucursal_regla` y `sucursal_asignada_en` en la misma fila del pedido. Sin
 * `sucursalEntrada` (flag apagado) o sin sucursales cargadas, quedan en NULL y el pedido se crea.
 */
const valoresPedido: Record<string, unknown>[] = [];
let reglas: DatosSucursales = { sucursales: [], zonas: [] };
const leer = vi.fn(async () => reglas);

const tx = {
  insert: () => ({
    values: (v: Record<string, unknown>) => {
      if ("tenantId" in v && "contactoNombre" in v) valoresPedido.push(v);
      return {
        onConflictDoNothing: () => ({
          returning: async () => [
            { id: "ped-1", numero: 1000, cuotasMax: null },
          ],
        }),
        then: (ok: (v: unknown) => void) => ok(undefined),
      };
    },
  }),
};
vi.mock("@/db", () => ({
  getDb: () => ({ transaction: (cb: (t: unknown) => unknown) => cb(tx) }),
}));
vi.mock("./sucursales-repo", () => ({
  leerSucursalesYZonas: (...a: unknown[]) => leer(...(a as [])),
}));
vi.mock("./stock-disponible", async (orig) => ({
  ...(await orig<typeof import("./stock-disponible")>()),
  disponiblesEnTx: async () => new Map([["1", null]]),
}));
vi.mock("./carrito-db", () => ({ vaciarCarritoTx: async () => {} }));
vi.mock("./catalog", () => ({ getProductosPorIds: async () => [] }));
vi.mock("./tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));
Object.assign(tx, { execute: async () => {} });

import { crearPedido, type DatosPedido } from "./pedidos";

const cotizacion = {
  lineas: [
    {
      id: "1",
      code: "C1",
      name: "Producto",
      brand: "",
      qty: 1,
      precioUnitario: 100,
      ivaPorcentaje: 21,
      subtotal: 100,
      iva: 21,
      total: 121,
    },
  ],
  hayProblemas: false,
  subtotal: 100,
  iva: 21,
  costoEnvio: 0,
  total: 121,
};

const base: DatosPedido = {
  contactoNombre: "Persona Ejemplo",
  contactoTelefono: "0000",
  entregaTipo: "envio",
  entregaCiudad: "Puerto Iguazú",
  pagoMetodo: "a_coordinar",
};
const crear = (extra: Partial<DatosPedido> = {}) =>
  crearPedido(
    { clerkUserId: "user_1" },
    { ...base, ...extra },
    cotizacion as never,
  );

beforeEach(() => {
  valoresPedido.length = 0;
  leer.mockClear();
  reglas = {
    sucursales: [
      {
        slug: "sede-a",
        nombre: "A",
        ciudad: "x",
        provincia: "x",
        direccion: "x",
        horario: "x",
        aceptaRetiro: true,
        aceptaEnvio: true,
        envioCiudades: [],
        orden: 1,
        activa: true,
        predeterminada: false,
      },
      {
        slug: "sede-b",
        nombre: "B",
        ciudad: "x",
        provincia: "x",
        direccion: "x",
        horario: "x",
        aceptaRetiro: true,
        aceptaEnvio: true,
        envioCiudades: [],
        orden: 2,
        activa: true,
        predeterminada: true,
      },
    ],
    zonas: [
      {
        id: "z1",
        provinciaClave: "misiones",
        sucursal: "sede-a",
        facturaSucursal: null,
      },
    ],
  };
});

describe("crearPedido y la sucursal", () => {
  it("con sucursalEntrada congela sucursal, regla y fecha, releyendo las reglas en la transacción", async () => {
    await crear({
      sucursalEntrada: {
        entregaTipo: "envio",
        provincia: "misiones",
        ciudad: "Puerto Iguazú",
      },
    });
    expect(leer).toHaveBeenCalledTimes(1);
    expect(leer).toHaveBeenCalledWith(tx);
    expect(valoresPedido[0]).toMatchObject({
      sucursal: "sede-a",
      sucursalRegla: {
        v: 1,
        regla: "zona:misiones",
        motivo: "zona",
        zonaId: "z1",
      },
    });
    expect(valoresPedido[0].sucursalAsignadaEn).toBeInstanceOf(Date);
  });

  it("retiro en un local: regla retiro:<slug>", async () => {
    await crear({
      entregaTipo: "retiro",
      sucursalEntrada: { entregaTipo: "retiro", sucursalRetiro: "sede-b" },
    });
    expect(valoresPedido[0]).toMatchObject({
      sucursal: "sede-b",
      sucursalRegla: { regla: "retiro:sede-b" },
    });
  });

  it("flag apagado (sin sucursalEntrada): NULL y no lee nada", async () => {
    await crear();
    expect(leer).not.toHaveBeenCalled();
    expect(valoresPedido[0]).toMatchObject({
      sucursal: null,
      sucursalRegla: null,
      sucursalAsignadaEn: null,
    });
  });

  it("sin sucursales cargadas: NULL y no falla", async () => {
    reglas = { sucursales: [], zonas: [] };
    await crear({
      sucursalEntrada: { entregaTipo: "envio", provincia: "misiones" },
    });
    expect(valoresPedido[0]).toMatchObject({
      sucursal: null,
      sucursalRegla: null,
      sucursalAsignadaEn: null,
    });
  });

  it("un cambio posterior de las reglas no altera lo ya congelado (la regla viaja en el pedido)", async () => {
    await crear({
      sucursalEntrada: {
        entregaTipo: "envio",
        provincia: "misiones",
        ciudad: "Puerto Iguazú",
      },
    });
    reglas = {
      ...reglas,
      zonas: [
        {
          id: "z1",
          provinciaClave: "misiones",
          sucursal: "sede-b",
          facturaSucursal: null,
        },
      ],
    };
    await crear({
      sucursalEntrada: {
        entregaTipo: "envio",
        provincia: "misiones",
        ciudad: "Puerto Iguazú",
      },
    });
    expect(valoresPedido[0]).toMatchObject({ sucursal: "sede-a" });
    expect(valoresPedido[1]).toMatchObject({ sucursal: "sede-b" });
  });
});
