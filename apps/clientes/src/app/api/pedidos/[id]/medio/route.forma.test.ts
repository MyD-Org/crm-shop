import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentoAbierto } from "@/lib/pedidos";

/**
 * Forma de pago en POST /api/pedidos/:id/medio (change `listas-por-forma-de-pago`, rebanada C): el
 * servidor recotiza y recongela con la lista de la forma, rechaza formas no disponibles (400) y no
 * toca un pedido con cobro en vuelo (409) ni con un pago en revisión (409).
 */

const pedidoParaCambiarMedio = vi.fn();
const cambiarMedioPedido = vi.fn();
const intentoAbiertoDelPedido = vi.fn();
const resolverIntentoAbierto = vi.fn();
const cotizar = vi.fn();
const identidadActual = vi.fn();
let permitido = true;

vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => permitido }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidadActual() }));
vi.mock("@/lib/catalogo-flag", () => ({ catalogoSoloVisibles: async () => false }));
vi.mock("@/lib/cache-invalidar", () => ({ marcarStockCambiado: () => {} }));
vi.mock("@/lib/contacto-pedido-repo", () => ({ contactoDelPedido: async () => null }));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: async () => null }));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: async () => false }));
vi.mock("@/lib/pagos", () => ({ procesadorConfigurado: () => true }));
vi.mock("@/lib/pagos/cuentas-sucursales", async (orig) => ({
  ...(await orig<typeof import("@/lib/pagos/cuentas-sucursales")>()),
  proveedorDeIntento: async () => ({ id: "mercadopago", cuenta: "mdp" }),
}));
vi.mock("@/lib/pagos/intento-abierto", () => ({ resolverIntentoAbierto: (...a: unknown[]) => resolverIntentoAbierto(...a) }));
vi.mock("@/lib/pedido-avisos", () => ({
  avisoOperadorAlCrear: () => false,
  avisarPedidoRecibido: async () => {},
  avisarOperadorPedidoNuevo: async () => {},
  avisarPedidoSiFalta: async () => true,
}));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/pedidos", () => ({
  cuentasRechazadasDelPedido: async () => [],
  pedidoParaCambiarMedio: (...a: unknown[]) => pedidoParaCambiarMedio(...a),
  cambiarMedioPedido: (...a: unknown[]) => cambiarMedioPedido(...a),
  intentoAbiertoDelPedido: (...a: unknown[]) => intentoAbiertoDelPedido(...a),
  lineasDelPedidoParaCarrito: async () => [],
}));
vi.mock("@/lib/medios-pago-repo", () => ({
  leerMediosPagoTolerante: async () =>
    ["mercadopago", "payway", "transferencia"].map((slug, orden) => ({
      slug,
      nombre: slug,
      instrucciones: "",
      activo: true,
      orden,
      aplicaRetiro: true,
      aplicaEnvio: true,
      audiencia: "publico",
      cobroOnline: slug !== "transferencia",
      idListaPrecios: "A",
      listasPorForma: { debito: "B" },
      condicionesCuotas: [],
    })),
}));

import { POST } from "./route";

const COT = { lineas: [{ id: "1", qty: 2, subtotal: 100, iva: 21, total: 121 }], hayProblemas: false, subtotal: 100, iva: 21, costoEnvio: 0, total: 121, listaPrivada: false };

const llamar = (body: unknown) =>
  POST(new Request("http://localhost/api/pedidos/p1/medio", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "p1" }),
  });

const abierto: IntentoAbierto = { id: "i1", proveedor: "mercadopago", referencia: "r1", creadoEn: new Date() };

beforeEach(() => {
  for (const f of [pedidoParaCambiarMedio, cambiarMedioPedido, intentoAbiertoDelPedido, resolverIntentoAbierto, cotizar]) f.mockReset();
  permitido = true;
  identidadActual.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
  pedidoParaCambiarMedio.mockResolvedValue({
    entregaTipo: "retiro",
    pagoMetodo: "mercadopago",
    lineas: [{ id: "1", qty: 2 }],
    formaCobro: null,
    pagoRevision: null,
  });
  intentoAbiertoDelPedido.mockResolvedValue(null);
  cotizar.mockResolvedValue(COT);
  cambiarMedioPedido.mockResolvedValue({ ok: true, id: "p1", numero: "PED-00000007", cuotas: null, formaCobro: "debito", total: 121, cuentaPago: null });
});

describe("POST /api/pedidos/:id/medio con forma", () => {
  it("débito: recotiza con la lista de débito, recongela la forma y la devuelve", async () => {
    const r = await llamar({ pagoMetodo: "mercadopago", forma: "debito" });
    expect(r.status).toBe(200);
    expect((await r.json()).formaCobro).toBe("debito");
    expect(cotizar.mock.calls[0][1]).toMatchObject({ idListaMedio: "B" });
    expect(cambiarMedioPedido.mock.calls[0][2]).toMatchObject({ pagoMetodo: "mercadopago", formaCobro: "debito", idPriceList: "B" });
  });

  it("crédito: la lista del medio", async () => {
    await llamar({ pagoMetodo: "mercadopago", forma: "credito" });
    expect(cotizar.mock.calls[0][1]).toMatchObject({ idListaMedio: "A" });
    expect(cambiarMedioPedido.mock.calls[0][2]).toMatchObject({ formaCobro: "credito", idPriceList: "A" });
  });

  it("sin forma: nace con la primera que ofrece el medio (crédito)", async () => {
    await llamar({ pagoMetodo: "mercadopago" });
    expect(cambiarMedioPedido.mock.calls[0][2]).toMatchObject({ formaCobro: "credito" });
  });

  it("Payway: débito con su lista; cuenta_mp es 400 sin tocar el pedido", async () => {
    expect((await llamar({ pagoMetodo: "payway", forma: "debito" })).status).toBe(200);
    expect(cambiarMedioPedido.mock.calls[0][2]).toMatchObject({ pagoMetodo: "payway", formaCobro: "debito", idPriceList: "B" });
    cambiarMedioPedido.mockClear();
    const r = await llamar({ pagoMetodo: "payway", forma: "cuenta_mp" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Esa forma de pago no está disponible para este medio.");
    expect(cambiarMedioPedido).not.toHaveBeenCalled();
  });

  it("forma inválida: 400 sin tocar el pedido", async () => {
    const r = await llamar({ pagoMetodo: "mercadopago", forma: "efectivo" });
    expect(r.status).toBe(400);
    expect(cambiarMedioPedido).not.toHaveBeenCalled();
  });

  it("medio que no cobra en línea: ignora la forma (forma null)", async () => {
    await llamar({ pagoMetodo: "transferencia", forma: "debito" });
    expect(cambiarMedioPedido.mock.calls[0][2]).toMatchObject({ pagoMetodo: "transferencia", formaCobro: null, idPriceList: "A" });
  });

  it("cuotas con débito: 422 cuotas_no_disponibles", async () => {
    const r = await llamar({ pagoMetodo: "mercadopago", forma: "debito", cuotas: 3 });
    expect(r.status).toBe(422);
    expect(cambiarMedioPedido).not.toHaveBeenCalled();
  });

  it("cobro en vuelo: 409 en usted y no se cambia la forma", async () => {
    intentoAbiertoDelPedido.mockResolvedValue(abierto);
    resolverIntentoAbierto.mockResolvedValue("en_curso");
    const r = await llamar({ pagoMetodo: "mercadopago", forma: "debito" });
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("pago_en_curso");
    expect(cambiarMedioPedido).not.toHaveBeenCalled();
  });

  it("pago en revisión: 409 en usted sin recotizar", async () => {
    pedidoParaCambiarMedio.mockResolvedValue({
      entregaTipo: "retiro",
      pagoMetodo: "mercadopago",
      lineas: [{ id: "1", qty: 2 }],
      formaCobro: "credito",
      pagoRevision: "forma_distinta",
    });
    const r = await llamar({ pagoMetodo: "mercadopago", forma: "debito" });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.motivo).toBe("pago_en_revision");
    expect(j.error).toBe("Este pedido tiene un pago en revisión. Comuníquese con nosotros.");
    expect(cotizar).not.toHaveBeenCalled();
    expect(cambiarMedioPedido).not.toHaveBeenCalled();
  });

  it("pago en revisión detectado dentro de la transacción: 409", async () => {
    cambiarMedioPedido.mockResolvedValue({ ok: false, motivo: "pago_en_revision" });
    const r = await llamar({ pagoMetodo: "mercadopago", forma: "debito" });
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("pago_en_revision");
  });

  it("rate limit: 429 en usted", async () => {
    permitido = false;
    const r = await llamar({ pagoMetodo: "mercadopago", forma: "debito" });
    expect(r.status).toBe(429);
    expect((await r.json()).error).toMatch(/Espere/);
  });
});
