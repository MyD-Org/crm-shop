import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";
import { ErrorProveedor, type ProveedorPago } from "./tipos";

/**
 * Forma congelada del pedido (listas de precio por forma de pago, rebanada D): la forma que declara el
 * navegador (en Payway, la modalidad del `payment_method_id`) tiene que ser `orders.forma_cobro`, y se
 * rechaza con 409 `forma_distinta` ANTES de reservar el intento o llamar al procesador. Sin forma
 * congelada se cobra como siempre, y no hay ninguna consulta ni exigencia de BIN para MP.
 */

const registrarCobro = vi.fn();
const reservarIntento = vi.fn(async (..._a: unknown[]) => ({ intentoId: "i1" }));
const getPedidoParaPago = vi.fn();
const getItemsParaAntifraude = vi.fn();
const crearPago = vi.fn();
const fijarReferenciaIntento = vi.fn();
const cerrarIntentoSinPago = vi.fn();
const registrarIntentoFallido = vi.fn();
const orden: string[] = [];

// Formas de pago del medio (migración 0073 del CRM). Por defecto, sin dato = todas las del procesador.
const medios = vi.hoisted(() => ({
  lista: null as null | { slug: string; opcionesCobro?: string[]; condicionesCuotas?: { cuotas: number; marcas?: string[] | null }[] }[],
}));
vi.mock("@/lib/medios-pago-repo", () => ({
  leerMediosPagoTolerante: async () => medios.lista ?? [{ slug: "mercadopago" }, { slug: "payway" }],
}));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@cliente.example" }),
}));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => true }));
vi.mock("@/lib/pedidos", async (original) => ({
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  reservarIntento: (...a: unknown[]) => reservarIntento(...a),
  getPedidoParaPago: (...a: unknown[]) => getPedidoParaPago(...a),
  getItemsParaAntifraude: (...a: unknown[]) => getItemsParaAntifraude(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
  registrarIntentoFallido: (...a: unknown[]) => registrarIntentoFallido(...a),
  fijarReferenciaIntento: (...a: unknown[]) => fijarReferenciaIntento(...a),
  cerrarIntentoSinPago: (...a: unknown[]) => cerrarIntentoSinPago(...a),
}));
vi.mock("./intento-abierto", () => ({ resolverIntentoAbierto: async () => "en_curso" }));

/**
 * Procesadores de prueba: `cobrarPedido` recibe el id y arma el proveedor ligado a la cuenta del pedido
 * con `proveedorPago(id, cuenta)`. Acá esa fábrica devuelve el doble registrado con ese id. La elección
 * de la cuenta se prueba aparte (cobrar.cuenta.test.ts): acá toda cuenta es "igz" y está configurada
 * mientras `configurado` sea true.
 */
const falsos = vi.hoisted(() => new Map<string, import("./tipos").ProveedorPago>());
const cuentas = vi.hoisted(() => ({ configurado: true }));
vi.mock("@/lib/pagos", async (orig) => ({
  ...(await orig<typeof import("@/lib/pagos")>()),
  proveedorPago: (id: string, cuenta: string) => {
    const p = falsos.get(id);
    return p ? { ...p, cuenta } : null;
  },
  rasgosProcesador: (id: string) => {
    const p = falsos.get(id);
    return p
      ? { requiereBin: Boolean(p.requiereBin), requiereAntifraude: Boolean(p.requiereAntifraude), conWebhook: false }
      : null;
  },
}));
vi.mock("./credenciales", async (orig) => ({
  ...(await orig<typeof import("./credenciales")>()),
  hayCuentaConfigurada: () => cuentas.configurado,
}));
vi.mock("./cuentas-sucursales", () => ({
  cuentaParaCobrar: async () =>
    cuentas.configurado ? { ok: true, cuenta: "igz", prevista: "igz", fallback: false } : { ok: false, motivo: "sin_cuenta" },
  proveedorDeIntento: async () => null,
}));

import { cobrarPedido } from "./cobrar";

let configurado = true;
const otro: ProveedorPago = {
  id: "otroprocesador",
  cuenta: "igz",
  configurado: () => configurado,
  crearPago: (...a: unknown[]) => crearPago(...a),
  consultarPago: async () => {
    throw new Error("no se usa");
  },
  cancelarPago: async () => {
    throw new Error("no se usa");
  },
};

/** Registra el doble con su id y cobra con ese procesador (la ruta pasa el id, no el proveedor). */
function procesador(p: ProveedorPago): string {
  falsos.set(p.id, p);
  return p.id;
}


const pedido = (pagoMetodo: string, extra: Partial<PedidoParaPago> = {}): PedidoParaPago => ({
  id: "p1", numero: "PED-1", total: 100, pagoEstado: "pendiente", pagoMetodo,
  clienteEmail: null, facturacionTipoDoc: null, facturacionNroDoc: null,
  cuotas: 1, estado: "pendiente", creadoEn: new Date(),
  contactoNombre: "Ana Gomez", contactoTelefono: "2235550100", entregaTipo: "retiro",
  entregaCiudad: null, entregaDireccion: null, facturacionDomicilio: null,
  ...extra,
});

const mp: ProveedorPago = {
  id: "mercadopago",
  cuenta: "igz",
  configurado: () => true,
  crearPago: (...a: unknown[]) => crearPago(...a),
  consultarPago: async () => {
    throw new Error("no se usa");
  },
  cancelarPago: async () => {
    throw new Error("no se usa");
  },
};
const payway: ProveedorPago & { requiereBin: boolean } = {
  ...mp,
  id: "payway",
  requiereBin: true,
  referenciaDeIntento: (id: string) => `ref-${id}`,
};

const pagarCon = (p: ProveedorPago, body: Record<string, unknown> = {}) =>
  cobrarPedido(
    procesador(p),
    new Request("https://tienda.example/api/pagos/x", {
      method: "POST",
      body: JSON.stringify({ pedidoId: "p1", token: "tok", cuotas: 1, ...body }),
    }),
  );

beforeEach(() => {
  configurado = true;
  cuentas.configurado = true;
  falsos.clear();
  for (const f of [registrarCobro, getPedidoParaPago, getItemsParaAntifraude, crearPago, fijarReferenciaIntento, cerrarIntentoSinPago, registrarIntentoFallido, reservarIntento]) f.mockReset();
  reservarIntento.mockResolvedValue({ intentoId: "i1" });
  medios.lista = null;
  for (const f of [fijarReferenciaIntento, cerrarIntentoSinPago, registrarIntentoFallido]) f.mockResolvedValue(undefined);
  crearPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "ok" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const sinCobro = () => {
  expect(reservarIntento).not.toHaveBeenCalled();
  expect(crearPago).not.toHaveBeenCalled();
  expect(registrarCobro).not.toHaveBeenCalled();
};

describe("cobrarPedido - forma congelada (Mercado Pago)", () => {
  it("forma congelada débito y la tarjeta declarada es de crédito: 409 forma_distinta sin llamar a MP", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("mercadopago", { formaCobro: "debito" }));
    const r = await pagarCon(mp, { metodoPagoId: "visa" });
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("forma_distinta");
    sinCobro();
  });

  it("forma congelada crédito y se declara débito: 409", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("mercadopago", { formaCobro: "credito" }));
    const r = await pagarCon(mp, { metodoPagoId: "debvisa" });
    expect(r.status).toBe(409);
    sinCobro();
  });

  it("cuenta_mp congelada y se paga con tarjeta: 409 antes de contactar a MP", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("mercadopago", { formaCobro: "cuenta_mp" }));
    const r = await pagarCon(mp, { metodoPagoId: "visa" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/no coincide con la de su pedido/);
    sinCobro();
  });

  it("forma que coincide: cobra el total congelado, sin BIN", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("mercadopago", { formaCobro: "debito" }));
    const r = await pagarCon(mp, { metodoPagoId: "debvisa" });
    expect(r.status).toBe(200);
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ monto: 100 }));
  });

  it("forma_cobro NULL: se cobra como hoy con cualquier tarjeta", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("mercadopago", { formaCobro: null }));
    expect((await pagarCon(mp, { metodoPagoId: "debvisa" })).status).toBe(200);
    expect((await pagarCon(mp, { metodoPagoId: "visa" })).status).toBe(200);
  });

  it("forma_cobro ausente (pedido viejo): se cobra como hoy", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("mercadopago"));
    expect((await pagarCon(mp, { metodoPagoId: "visa" })).status).toBe(200);
  });
});

describe("cobrarPedido - forma congelada (Payway)", () => {
  it("forma congelada débito y se manda un id de crédito (Visa 1): 409 sin llamar a Payway", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("payway", { formaCobro: "debito" }));
    const r = await pagarCon(payway, { bin: "450799", metodoPagoId: "1" });
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("forma_distinta");
    sinCobro();
  });

  it("forma congelada crédito y se manda un id de débito (Visa débito 31): 409", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("payway", { formaCobro: "credito" }));
    const r = await pagarCon(payway, { bin: "450799", metodoPagoId: "31" });
    expect(r.status).toBe(409);
    sinCobro();
  });

  it.each([["1", "credito"], ["31", "debito"]])("id %s con forma %s: cobra", async (id, forma) => {
    getPedidoParaPago.mockResolvedValue(pedido("payway", { formaCobro: forma as "credito" | "debito" }));
    const r = await pagarCon(payway, { bin: "450799", metodoPagoId: id });
    expect(r.status).toBe(200);
    expect(crearPago).toHaveBeenCalledTimes(1);
  });
});

describe("cobrarPedido - pedido con pago en revisión", () => {
  it.each(["forma_distinta", "monto_distinto"])("pago_revision=%s: 409 pedido_no_cobrable sin cobrar", async (rev) => {
    getPedidoParaPago.mockResolvedValue(pedido("mercadopago", { pagoRevision: rev }));
    const r = await pagarCon(mp, { metodoPagoId: "visa" });
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("pedido_no_cobrable");
    sinCobro();
  });
});
