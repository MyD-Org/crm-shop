import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentoAbierto } from "@/lib/pedidos";

/**
 * Cambiar el medio de pago de un pedido pendiente, sobre el MISMO pedido. El servidor decide todo:
 * dueño, estado, cobro en vuelo, medio ofrecible, recotización y bloqueos (409 en usted).
 */

const pedidoParaCambiarMedio = vi.fn();
const cambiarMedioPedido = vi.fn();
const intentoAbiertoDelPedido = vi.fn();
const resolverIntentoAbierto = vi.fn();
const cotizar = vi.fn();
const identidadActual = vi.fn();
const avisarPedidoRecibido = vi.fn();
const avisarOperadorPedidoNuevo = vi.fn();
const despues: Array<() => Promise<void> | void> = [];
let mediosOk = true;
let cuotasFlag = false;

vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (f: () => Promise<void> | void) => {
    despues.push(f);
  },
}));
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidadActual() }));
vi.mock("@/lib/catalogo-flag", () => ({ catalogoSoloVisibles: async () => false }));
vi.mock("@/lib/cache-invalidar", () => ({ marcarStockCambiado: () => {} }));
vi.mock("@/lib/contacto-pedido-repo", () => ({ contactoDelPedido: async () => null }));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: async () => null }));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => cuotasFlag }));
vi.mock("@/lib/pagos", () => ({
  proveedorPago: (id: string) => (id === "mercadopago" || id === "payway" ? { id } : null),
  procesadorConfigurado: () => true,
}));
vi.mock("@/lib/pagos/intento-abierto", () => ({ resolverIntentoAbierto: (...a: unknown[]) => resolverIntentoAbierto(...a) }));
vi.mock("@/lib/pedido-avisos", () => ({
  avisoOperadorAlCrear: (m: string) => m !== "mercadopago" && m !== "payway",
  avisarPedidoRecibido: (...a: unknown[]) => avisarPedidoRecibido(...a),
  avisarOperadorPedidoNuevo: (...a: unknown[]) => avisarOperadorPedidoNuevo(...a),
}));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/pedidos", () => ({
  pedidoParaCambiarMedio: (...a: unknown[]) => pedidoParaCambiarMedio(...a),
  cambiarMedioPedido: (...a: unknown[]) => cambiarMedioPedido(...a),
  intentoAbiertoDelPedido: (...a: unknown[]) => intentoAbiertoDelPedido(...a),
  lineasDelPedidoParaCarrito: async () => [],
}));
vi.mock("@/lib/medios-pago-repo", () => ({
  leerMediosPagoTolerante: async () =>
    mediosOk
      ? ["transferencia", "mercadopago"].map((slug, orden) => ({
          slug,
          nombre: slug,
          instrucciones: "",
          activo: true,
          orden,
          aplicaRetiro: true,
          aplicaEnvio: true,
          audiencia: "todos",
          cobroOnline: slug === "mercadopago",
          idListaPrecios: null,
          condicionesCuotas: [],
        }))
      : [],
}));

import { POST } from "./route";

const COT = {
  lineas: [{ id: "1", qty: 2, subtotal: 100, iva: 21, total: 121 }],
  hayProblemas: false,
  subtotal: 100,
  iva: 21,
  costoEnvio: 0,
  total: 121,
  listaPrivada: false,
};

const llamar = (body: unknown) =>
  POST(
    new Request("http://localhost/api/pedidos/p1/medio", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "p1" }) },
  );

const abierto: IntentoAbierto = { id: "i1", proveedor: "mercadopago", referencia: "r1", creadoEn: new Date() };

beforeEach(() => {
  for (const f of [
    pedidoParaCambiarMedio, cambiarMedioPedido, intentoAbiertoDelPedido, resolverIntentoAbierto, cotizar,
    avisarPedidoRecibido, avisarOperadorPedidoNuevo,
  ]) f.mockReset();
  despues.length = 0;
  mediosOk = true;
  cuotasFlag = false;
  identidadActual.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
  pedidoParaCambiarMedio.mockResolvedValue({
    entregaTipo: "retiro",
    pagoMetodo: "mercadopago",
    lineas: [{ id: "1", qty: 2 }],
  });
  intentoAbiertoDelPedido.mockResolvedValue(null);
  cotizar.mockResolvedValue(COT);
  cambiarMedioPedido.mockResolvedValue({ ok: true, id: "p1", numero: "PED-00000007", cuotas: null, total: 121, cuentaPago: null });
});

describe("POST /api/pedidos/:id/medio", () => {
  it("a un medio sin cobro en línea: actualiza el MISMO pedido, no crea otro y manda 'pedido recibido' una vez", async () => {
    const r = await llamar({ pagoMetodo: "transferencia" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ id: "p1", numero: "PED-00000007", total: 121 });
    expect(cambiarMedioPedido).toHaveBeenCalledTimes(1);
    expect(cambiarMedioPedido.mock.calls[0][0]).toBe("p1");
    expect(cambiarMedioPedido.mock.calls[0][2]).toMatchObject({ pagoMetodo: "transferencia", cuotas: null });
    await Promise.all(despues.map((f) => f()));
    expect(avisarPedidoRecibido).toHaveBeenCalledTimes(1);
    expect(avisarPedidoRecibido).toHaveBeenCalledWith("p1");
  });

  it("a otro medio en línea: no manda mails hasta el pago", async () => {
    pedidoParaCambiarMedio.mockResolvedValue({ entregaTipo: "retiro", pagoMetodo: "mercadopago", lineas: [{ id: "1", qty: 2 }] });
    const r = await llamar({ pagoMetodo: "mercadopago" });
    expect(r.status).toBe(200);
    await Promise.all(despues.map((f) => f()));
    expect(avisarPedidoRecibido).not.toHaveBeenCalled();
  });

  it("la cotización ignora el stock que el propio pedido ya reserva", async () => {
    cotizar.mockResolvedValue({
      ...COT,
      lineas: [{ id: "1", qty: 2, subtotal: 100, iva: 21, total: 121, problema: "stock_insuficiente" }],
      hayProblemas: true,
      subtotal: 0,
      iva: 0,
      total: 0,
    });
    const r = await llamar({ pagoMetodo: "transferencia" });
    expect(r.status).toBe(200);
    expect(cambiarMedioPedido.mock.calls[0][2].cotizacion).toMatchObject({ hayProblemas: false, total: 121 });
  });

  it("producto sin precio con el medio nuevo: 409 y el pedido no se toca", async () => {
    cotizar.mockResolvedValue({
      ...COT,
      lineas: [{ id: "1", qty: 2, problema: "sin_precio", subtotal: 0, iva: 0, total: 0 }],
      hayProblemas: true,
    });
    const r = await llamar({ pagoMetodo: "transferencia" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "productos_cambiaron" });
    expect(cambiarMedioPedido).not.toHaveBeenCalled();
  });

  it("el total visto no coincide: 409 precio_cambio sin tocar el pedido", async () => {
    const r = await llamar({ pagoMetodo: "transferencia", totalVisto: 100 });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "precio_cambio", totalNuevo: 121 });
    expect(cambiarMedioPedido).not.toHaveBeenCalled();
  });

  it("medio no ofrecible: 400", async () => {
    const r = await llamar({ pagoMetodo: "bitcoin" });
    expect(r.status).toBe(400);
    expect(cambiarMedioPedido).not.toHaveBeenCalled();
  });

  it("cobro en vuelo: 409 en usted sin cambiar nada", async () => {
    intentoAbiertoDelPedido.mockResolvedValue(abierto);
    resolverIntentoAbierto.mockResolvedValue("en_curso");
    const r = await llamar({ pagoMetodo: "transferencia" });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.motivo).toBe("pago_en_curso");
    expect(j.error).toContain("Espere unos minutos");
    expect(cambiarMedioPedido).not.toHaveBeenCalled();
  });

  it("ya pagado: 409 'pagado'", async () => {
    intentoAbiertoDelPedido.mockResolvedValue(abierto);
    resolverIntentoAbierto.mockResolvedValue("pagado");
    const r = await llamar({ pagoMetodo: "transferencia" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "pagado" });
    expect(cambiarMedioPedido).not.toHaveBeenCalled();
  });

  it("el pedido ya no es de cobro en línea: 409 no_cambia", async () => {
    pedidoParaCambiarMedio.mockResolvedValue({ entregaTipo: "retiro", pagoMetodo: "transferencia", lineas: [] });
    const r = await llamar({ pagoMetodo: "mercadopago" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "no_cambia" });
  });

  it("los bloqueos de la transacción (intento abierto entre medio, comprobante informado) salen como 409", async () => {
    cambiarMedioPedido.mockResolvedValue({ ok: false, motivo: "pago_informado" });
    const r = await llamar({ pagoMetodo: "transferencia" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "pago_informado" });
    cambiarMedioPedido.mockResolvedValue({ ok: false, motivo: "pago_en_curso" });
    expect((await llamar({ pagoMetodo: "transferencia" })).status).toBe(409);
  });

  it("pedido ajeno o que no está pendiente: 404 genérico", async () => {
    pedidoParaCambiarMedio.mockResolvedValue(null);
    expect((await llamar({ pagoMetodo: "transferencia" })).status).toBe(404);
    expect(cambiarMedioPedido).not.toHaveBeenCalled();
  });

  it("pasa el dueño de la sesión, nunca del body", async () => {
    await llamar({ pagoMetodo: "transferencia", clerkUserId: "otro" });
    expect(pedidoParaCambiarMedio).toHaveBeenCalledWith("p1", { clerkUserId: "user_1", clienteCodigo: undefined });
    expect(cambiarMedioPedido.mock.calls[0][1]).toEqual({ clerkUserId: "user_1", clienteCodigo: undefined });
  });

  it("sin sesión: 401", async () => {
    identidadActual.mockResolvedValue({ clerkUserId: null, cliente: null });
    expect((await llamar({ pagoMetodo: "transferencia" })).status).toBe(401);
    expect(pedidoParaCambiarMedio).not.toHaveBeenCalled();
  });
});
