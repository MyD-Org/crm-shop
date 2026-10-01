import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatosSucursales } from "./sucursales-repo";
import type { CuentaBancaria } from "./cuentas-bancarias";

/**
 * `crearPedido` por transferencia: relee las cuentas del CRM DENTRO de la transacción (sin caché),
 * resuelve la cuenta con la sucursal asignada y el total cotizado, y congela el snapshot en
 * `orders.pago_cuenta`. Otros medios de pago no llevan cuenta.
 */
const valoresPedido: Record<string, unknown>[] = [];
let reglas: DatosSucursales = { sucursales: [], zonas: [] };
let cuentas: CuentaBancaria[] = [];
const leerCuentas = vi.fn(async () => cuentas);

const tx = {
  insert: () => ({
    values: (v: Record<string, unknown>) => {
      if ("tenantId" in v && "contactoNombre" in v) valoresPedido.push(v);
      return {
        onConflictDoNothing: () => ({
          returning: async () => [{ id: "ped-1", numero: 1000, cuotasMax: null }],
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
  leerSucursalesYZonas: async () => reglas,
}));
vi.mock("./cuentas-bancarias-repo", () => ({
  leerCuentasBancariasEnTx: (...a: unknown[]) => leerCuentas(...(a as [])),
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

const cuenta = (p: Partial<CuentaBancaria> & { id: string }): CuentaBancaria => ({
  alias: `alias.${p.id}`,
  cbu: "0000000000000000000000",
  banco: "Banco Ejemplo",
  titular: "Titular Ejemplo SA",
  cuit: "30000000000",
  todasLasSucursales: true,
  sucursalSlugs: [],
  montoMin: null,
  montoMax: null,
  activa: true,
  predeterminada: false,
  orden: 0,
  ...p,
});

const base: DatosPedido = {
  contactoNombre: "Persona Ejemplo",
  contactoTelefono: "0000",
  entregaTipo: "retiro",
  pagoMetodo: "transferencia",
};
const crear = (extra: Partial<DatosPedido> = {}) =>
  crearPedido({ clerkUserId: "user_1" }, { ...base, ...extra }, cotizacion as never);

const sucursal = (slug: string, predeterminada: boolean, orden: number) => ({
  slug,
  nombre: slug,
  ciudad: "x",
  provincia: "x",
  direccion: "x",
  horario: "x",
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden,
  activa: true,
  predeterminada,
});

beforeEach(() => {
  valoresPedido.length = 0;
  leerCuentas.mockClear();
  cuentas = [];
  reglas = {
    sucursales: [sucursal("igz", false, 1), sucursal("mdp", true, 2)],
    zonas: [{ id: "z1", provinciaClave: "misiones", sucursal: "igz", facturaSucursal: null }],
  };
});

describe("crearPedido: cuenta de la transferencia", () => {
  it("retiro: congela la cuenta que corresponde al local de retiro y la devuelve", async () => {
    cuentas = [
      cuenta({ id: "A", orden: 1, todasLasSucursales: false, sucursalSlugs: ["igz"] }),
      cuenta({ id: "B", orden: 2, todasLasSucursales: false, sucursalSlugs: ["mdp"], alias: "mdp.alias" }),
    ];
    const r = await crear({ sucursalEntrada: { entregaTipo: "retiro", sucursalRetiro: "mdp" } });
    expect(leerCuentas).toHaveBeenCalledWith(tx);
    expect(valoresPedido[0].pagoCuenta).toMatchObject({
      v: 1,
      cuentaId: "B",
      alias: "mdp.alias",
      motivo: "regla",
      sucursal: "mdp",
      totalEvaluado: 121,
    });
    expect(r.cuentaPago).toMatchObject({ cuentaId: "B" });
  });

  it("envío: usa la sucursal de la zona de la provincia", async () => {
    cuentas = [
      cuenta({ id: "A", orden: 2, todasLasSucursales: false, sucursalSlugs: ["igz"] }),
      cuenta({ id: "B", orden: 1, todasLasSucursales: false, sucursalSlugs: ["mdp"] }),
    ];
    await crear({
      entregaTipo: "envio",
      entregaCiudad: "Puerto Iguazú",
      sucursalEntrada: { entregaTipo: "envio", provincia: "misiones", ciudad: "Puerto Iguazú" },
    });
    expect(valoresPedido[0].pagoCuenta).toMatchObject({ cuentaId: "A", sucursal: "igz" });
  });

  it("flag de sucursales apagado: sólo matchean las cuentas de 'todas las sucursales'", async () => {
    cuentas = [
      cuenta({ id: "A", orden: 1, todasLasSucursales: false, sucursalSlugs: ["igz"] }),
      cuenta({ id: "T", orden: 5, todasLasSucursales: true }),
    ];
    await crear();
    expect(valoresPedido[0].pagoCuenta).toMatchObject({ cuentaId: "T", sucursal: null });
  });

  it("flag apagado sin cuentas 'todas': cae a la predeterminada", async () => {
    cuentas = [
      cuenta({ id: "A", orden: 1, todasLasSucursales: false, sucursalSlugs: ["igz"] }),
      cuenta({ id: "P", orden: 9, predeterminada: true, todasLasSucursales: false, sucursalSlugs: ["mdp"] }),
    ];
    await crear();
    expect(valoresPedido[0].pagoCuenta).toMatchObject({ cuentaId: "P", motivo: "predeterminada" });
  });

  it("sin cuenta aplicable: pago_cuenta queda NULL y el pedido se crea", async () => {
    const r = await crear();
    expect(valoresPedido[0].pagoCuenta).toBeNull();
    expect(r.cuentaPago).toBeNull();
    expect(r.id).toBe("ped-1");
  });

  it("evalúa el rango de monto con el total cotizado", async () => {
    cuentas = [
      cuenta({ id: "CHICA", orden: 1, montoMax: 100 }),
      cuenta({ id: "GRANDE", orden: 2, montoMin: 100.01 }),
    ];
    await crear();
    expect(valoresPedido[0].pagoCuenta).toMatchObject({ cuentaId: "GRANDE" });
  });

  it("otro medio de pago (Mercado Pago): no lee ni congela cuenta", async () => {
    cuentas = [cuenta({ id: "A" })];
    const r = await crear({ pagoMetodo: "mercadopago" });
    expect(leerCuentas).not.toHaveBeenCalled();
    expect(valoresPedido[0].pagoCuenta).toBeNull();
    expect(r.cuentaPago).toBeNull();
  });
});
