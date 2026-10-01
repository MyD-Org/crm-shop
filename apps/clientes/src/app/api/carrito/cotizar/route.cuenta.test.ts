import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CuentaBancaria } from "@/lib/cuentas-bancarias";
import type { DatosSucursales } from "@/lib/sucursales-repo";

/**
 * `conCuenta`: con identidad, la cotización suma `cuentaTransferencia` (la cuenta resuelta con las
 * lecturas cacheadas, la sucursal de retiro/zona y `cotizacion.total`). Sin sesión no se devuelve.
 */
let identidad: { clerkUserId: string | null; cliente: { codigocliente: string } | null };
let total = 1210;
let cuentas: CuentaBancaria[] = [];
let sucursalesOn = true;
let datos: DatosSucursales;

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => identidad,
  idPriceListCliente: async () => "7",
}));
vi.mock("@/lib/cotizacion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cotizacion")>()),
  cotizar: async () => ({
    lineas: [],
    subtotal: 1000,
    iva: 210,
    costoEnvio: 0,
    total,
    hayProblemas: false,
  }),
}));
vi.mock("@/lib/sucursales-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: async () => (await import("@/lib/envio")).CONFIG_ENVIO_DEFAULT,
}));
vi.mock("@/lib/cuentas-bancarias-datos", () => ({ cuentasBancariasCacheadas: async () => cuentas }));
vi.mock("@/lib/sucursales-datos", () => ({ sucursalesCacheadas: async () => datos }));
vi.mock("@/lib/sucursales-flag", () => ({ sucursalesHabilitadas: async () => sucursalesOn }));

import { POST } from "./route";

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

const suc = (slug: string, orden: number, predeterminada = false) => ({
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

let ipN = 0;
function pedido(extra: Record<string, unknown> = {}) {
  return new Request("https://tienda.example/api/carrito/cotizar", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `203.0.113.${100 + ipN++}` },
    body: JSON.stringify({ items: [{ id: "1", qty: 2 }], ...extra }),
  });
}

beforeEach(() => {
  identidad = { clerkUserId: "user_1", cliente: null };
  total = 1210;
  sucursalesOn = true;
  cuentas = [
    cuenta({ id: "I", orden: 1, todasLasSucursales: false, sucursalSlugs: ["igz"] }),
    cuenta({ id: "M", orden: 2, todasLasSucursales: false, sucursalSlugs: ["mdp"] }),
    cuenta({ id: "T", orden: 3 }),
  ];
  datos = {
    sucursales: [suc("igz", 1), suc("mdp", 2, true)],
    zonas: [{ id: "z1", provinciaClave: "misiones", sucursal: "igz", facturaSucursal: null }],
  } as unknown as DatosSucursales;
});

describe("POST /api/carrito/cotizar con conCuenta", () => {
  it("sin conCuenta no trae la cuenta", async () => {
    const j = await (await POST(pedido())).json();
    expect(j).not.toHaveProperty("cuentaTransferencia");
  });

  it("con identidad y retiro: la cuenta del local elegido y el total cotizado", async () => {
    const j = await (await POST(pedido({ conCuenta: true, sucursalRetiro: "mdp" }))).json();
    expect(j.cuentaTransferencia).toMatchObject({ cuentaId: "M", sucursal: "mdp", totalEvaluado: 1210 });
  });

  it("envío: la cuenta de la sucursal de la zona de la provincia", async () => {
    const j = await (
      await POST(pedido({ conCuenta: true, entregaTipo: "envio", provincia: "Misiones" }))
    ).json();
    expect(j.cuentaTransferencia).toMatchObject({ cuentaId: "I", sucursal: "igz" });
  });

  it("sin sesión no se devuelve la cuenta", async () => {
    identidad = { clerkUserId: null, cliente: null };
    const j = await (await POST(pedido({ conCuenta: true, sucursalRetiro: "mdp" }))).json();
    expect(j).not.toHaveProperty("cuentaTransferencia");
  });

  it("cliente vinculado (cookie del CRM) también la recibe", async () => {
    identidad = { clerkUserId: null, cliente: { codigocliente: "C1" } };
    const j = await (await POST(pedido({ conCuenta: true, sucursalRetiro: "mdp" }))).json();
    expect(j.cuentaTransferencia).toMatchObject({ cuentaId: "M" });
  });

  it("flag de sucursales apagado: sólo cuentas de 'todas las sucursales'", async () => {
    sucursalesOn = false;
    const j = await (await POST(pedido({ conCuenta: true, sucursalRetiro: "mdp" }))).json();
    expect(j.cuentaTransferencia).toMatchObject({ cuentaId: "T", sucursal: null });
  });

  it("el rango de monto usa cotizacion.total", async () => {
    cuentas = [cuenta({ id: "CH", orden: 1, montoMax: 500 }), cuenta({ id: "GR", orden: 2, montoMin: 500.01 })];
    total = 2000;
    const j = await (await POST(pedido({ conCuenta: true, sucursalRetiro: "mdp" }))).json();
    expect(j.cuentaTransferencia.cuentaId).toBe("GR");
  });

  it("sin cuenta aplicable: cuentaTransferencia null", async () => {
    cuentas = [];
    const j = await (await POST(pedido({ conCuenta: true, sucursalRetiro: "mdp" }))).json();
    expect(j.cuentaTransferencia).toBeNull();
  });
});
