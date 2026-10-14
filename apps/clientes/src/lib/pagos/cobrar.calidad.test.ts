import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";
import type { DatosPago, ProveedorPago } from "./tipos";

/**
 * Datos de calidad del cobro con tarjeta en `cobrarPedido`: el emisor y el id de dispositivo vienen del
 * navegador y se sanean; las líneas, el comprador y la entrega salen del pedido persistido. Nada de esto
 * bloquea el cobro.
 */

const getPedidoParaPago = vi.fn();
const getItemsParaAntifraude = vi.fn();
const crearPago = vi.fn();

vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => [{ slug: "mercadopago" }] }));
vi.mock("./mercadopago-planes", () => ({ consultarPlanesMP: async () => ({ ok: false }) }));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@cliente.example" }),
}));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => true }));
vi.mock("@/lib/pedidos", async (original) => ({
  cuentasRechazadasDelPedido: async () => [],
  detalleCredencialesRechazadas: (c: string) => `credenciales_rechazadas:${c}`,
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  reservarIntento: async () => ({ intentoId: "i1" }),
  getPedidoParaPago: (...a: unknown[]) => getPedidoParaPago(...a),
  getItemsParaAntifraude: (...a: unknown[]) => getItemsParaAntifraude(...a),
  registrarCobro: vi.fn(),
  registrarIntentoFallido: vi.fn(async () => {}),
  fijarReferenciaIntento: vi.fn(),
  cerrarIntentoSinPago: vi.fn(),
}));
vi.mock("./intento-abierto", () => ({ resolverIntentoAbierto: async () => "en_curso" }));

const doble = vi.hoisted(() => ({ mp: null as null | import("./tipos").ProveedorPago }));
vi.mock("@/lib/pagos", async (orig) => ({
  ...(await orig<typeof import("@/lib/pagos")>()),
  proveedorPago: (id: string, cuenta: string) => (id === "mercadopago" && doble.mp ? { ...doble.mp, cuenta } : null),
}));
vi.mock("./credenciales", async (orig) => ({
  ...(await orig<typeof import("./credenciales")>()),
  hayCuentaConfigurada: () => true,
}));
vi.mock("./cuentas-sucursales", () => ({
  cuentaParaCobrar: async () => ({ ok: true, cuenta: "mdp", prevista: "mdp", fallback: false }),
  proveedorDeIntento: async () => null,
}));

import { cobrarPedido } from "./cobrar";

const mp = (aceptaInfoAdicional: boolean): ProveedorPago => ({
  id: "mercadopago",
  cuenta: "mdp",
  aceptaInfoAdicional,
  configurado: () => true,
  crearPago: (...a: unknown[]) => crearPago(...a),
  consultarPago: async () => {
    throw new Error("no se usa");
  },
  cancelarPago: async () => {
    throw new Error("no se usa");
  },
});

const pedido = (extra: Partial<PedidoParaPago> = {}): PedidoParaPago => ({
  id: "p1", numero: "PED-1", total: 50000, pagoEstado: "pendiente", pagoMetodo: "mercadopago",
  clienteEmail: null, facturacionTipoDoc: null, facturacionNroDoc: null,
  cuotas: 1, estado: "pendiente", creadoEn: new Date(),
  contactoNombre: "Ana Pérez", entregaTipo: "envio", entregaDireccion: "Calle Falsa 123", entregaCiudad: "Mar del Plata",
  ...extra,
});

const pagar = (body: Record<string, unknown>) =>
  cobrarPedido(
    "mercadopago",
    new Request("https://tienda.example/api/pagos/mercadopago", {
      method: "POST",
      body: JSON.stringify({ pedidoId: "p1", token: "tok", metodoPagoId: "visa", cuotas: 1, ...body }),
    }),
  );

const datosCobro = () => crearPago.mock.calls[0][0] as DatosPago;

beforeEach(() => {
  for (const f of [getPedidoParaPago, getItemsParaAntifraude, crearPago]) f.mockReset();
  doble.mp = mp(true);
  getPedidoParaPago.mockResolvedValue(pedido());
  getItemsParaAntifraude.mockResolvedValue([{ sku: "SKU-1", nombre: "Lámpara", cantidad: 2, total: 50000 }]);
  crearPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "ok" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("emisor e id de dispositivo: del navegador, saneados", () => {
  it("válidos (el emisor como número o texto) → llegan al proveedor", async () => {
    expect((await pagar({ issuerId: 310, deviceId: "armor.abc-123" })).status).toBe(200);
    expect(datosCobro()).toMatchObject({ issuerId: "310", deviceId: "armor.abc-123" });
  });

  it("inválidos → se descartan y se cobra igual", async () => {
    const r = await pagar({ issuerId: "310; drop", deviceId: "abc\r\nX-Otro: 1" });
    expect(r.status).toBe(200);
    expect(datosCobro()).not.toHaveProperty("issuerId");
    expect(datosCobro()).not.toHaveProperty("deviceId");
    expect(datosCobro().monto).toBe(50000);
  });
});

describe("datos adicionales: sólo del pedido persistido", () => {
  it("líneas, comprador y envío salen del pedido; lo que mande el navegador se ignora", async () => {
    await pagar({
      infoAdicional: { items: [{ id: "x", titulo: "trucho", cantidad: 1, precioUnitario: 1 }] },
      additional_info: { payer: { first_name: "Otro" } },
    });
    expect(getItemsParaAntifraude).toHaveBeenCalledWith("p1");
    expect(datosCobro().infoAdicional).toEqual({
      items: [{ id: "SKU-1", titulo: "Lámpara", cantidad: 2, precioUnitario: 25000 }],
      nombre: "Ana",
      apellido: "Pérez",
      envio: { direccion: "Calle Falsa 123", ciudad: "Mar del Plata" },
    });
  });

  it("si las líneas no se pueden leer, se cobra sin ellas (no bloquea)", async () => {
    getItemsParaAntifraude.mockRejectedValue(new Error("base caída"));
    expect((await pagar({})).status).toBe(200);
    expect(datosCobro().infoAdicional).toMatchObject({ items: [], nombre: "Ana" });
    expect(datosCobro().monto).toBe(50000);
  });

  it("un proveedor que no los aprovecha no los recibe ni se leen las líneas", async () => {
    doble.mp = mp(false);
    await pagar({ issuerId: "310", deviceId: "armor.abc" });
    expect(getItemsParaAntifraude).not.toHaveBeenCalled();
    for (const campo of ["issuerId", "deviceId", "infoAdicional"]) expect(datosCobro()).not.toHaveProperty(campo);
  });
});
