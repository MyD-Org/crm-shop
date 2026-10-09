import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentoAbierto } from "@/lib/pedidos";

/**
 * Cambiar el medio de pago de un pedido pendiente, sobre el MISMO pedido. El servidor decide todo:
 * dueño, estado, cobro en vuelo, medio ofrecible, recotización y bloqueos (409 en usted).
 */

const pedidoParaCambiarMedio = vi.fn();
const avisarPedidoSiFalta = vi.fn(async (_id: string) => true);
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
  procesadorConfigurado: () => true,
}));
// El intento abierto se resuelve con el proveedor ligado a la cuenta del pedido.
vi.mock("@/lib/pagos/cuentas-sucursales", async (orig) => ({
  ...(await orig<typeof import("@/lib/pagos/cuentas-sucursales")>()),
  proveedorDeIntento: async (i: { proveedor: string }) =>
    i.proveedor === "mercadopago" || i.proveedor === "payway" ? { id: i.proveedor, cuenta: "mdp" } : null,
}));
vi.mock("@/lib/pagos/intento-abierto", () => ({ resolverIntentoAbierto: (...a: unknown[]) => resolverIntentoAbierto(...a) }));
vi.mock("@/lib/pedido-avisos", () => ({
  avisoOperadorAlCrear: (m: string) => m !== "mercadopago" && m !== "payway",
  avisarPedidoRecibido: (...a: unknown[]) => avisarPedidoRecibido(...a),
  avisarOperadorPedidoNuevo: (...a: unknown[]) => avisarOperadorPedidoNuevo(...a),
  avisarPedidoSiFalta: (id: string) => avisarPedidoSiFalta(id),
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

import { GET, POST } from "./route";

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
    avisarPedidoRecibido, avisarOperadorPedidoNuevo, avisarPedidoSiFalta,
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
  it("a transferencia: actualiza el MISMO pedido, no crea otro y los avisos esperan a que se vaya de la pantalla", async () => {
    const r = await llamar({ pagoMetodo: "transferencia" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ id: "p1", numero: "PED-00000007", total: 121 });
    expect(cambiarMedioPedido).toHaveBeenCalledTimes(1);
    expect(cambiarMedioPedido.mock.calls[0][0]).toBe("p1");
    expect(cambiarMedioPedido.mock.calls[0][2]).toMatchObject({ pagoMetodo: "transferencia", cuotas: null });
    await Promise.all(despues.map((f) => f()));
    expect(avisarPedidoRecibido).not.toHaveBeenCalled();
    expect(avisarPedidoSiFalta).not.toHaveBeenCalled();
  });

  it("a otro medio en línea: no manda mails hasta el pago", async () => {
    pedidoParaCambiarMedio.mockResolvedValue({ entregaTipo: "retiro", pagoMetodo: "mercadopago", lineas: [{ id: "1", qty: 2 }] });
    const r = await llamar({ pagoMetodo: "mercadopago" });
    expect(r.status).toBe(200);
    await Promise.all(despues.map((f) => f()));
    expect(avisarPedidoRecibido).not.toHaveBeenCalled();
  });

  it("a Mercado Pago: la respuesta trae la public key de la cuenta del pedido y esa cuenta", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token");
    vi.stubEnv("MP_PUBLIC_KEY_MDP", "TEST-clave-publica-mdp");
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token");
    vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-clave-publica-igz");
    pedidoParaCambiarMedio.mockResolvedValue({
      entregaTipo: "retiro",
      pagoMetodo: "mercadopago",
      lineas: [{ id: "1", qty: 2 }],
      sucursal: "mdp",
      facturaSucursal: null,
    });
    const r = await llamar({ pagoMetodo: "mercadopago" });
    expect(await r.json()).toMatchObject({ mpPublicKey: "TEST-clave-publica-mdp", mpCuenta: "mdp" });
    vi.unstubAllEnvs();
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

  it("un medio sin cobro que no es transferencia (lo coordina el local): 409 no_cambia", async () => {
    pedidoParaCambiarMedio.mockResolvedValue({ entregaTipo: "retiro", pagoMetodo: "efectivo", lineas: [] });
    const r = await llamar({ pagoMetodo: "mercadopago" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "no_cambia" });
  });

  it("de transferencia todavía sin avisar a Mercado Pago: no sale ningún aviso (llegan con el pago)", async () => {
    pedidoParaCambiarMedio.mockResolvedValue({ entregaTipo: "retiro", pagoMetodo: "transferencia", lineas: [{ id: "1", qty: 2 }], avisosEnviados: false });
    expect((await llamar({ pagoMetodo: "mercadopago" })).status).toBe(200);
    await Promise.all(despues.map((f) => f()));
    expect(avisarOperadorPedidoNuevo).not.toHaveBeenCalled();
    expect(avisarPedidoRecibido).not.toHaveBeenCalled();
    expect(avisarPedidoSiFalta).not.toHaveBeenCalled();
  });

  it("de transferencia YA avisada a Mercado Pago: cambia y avisa al local del cambio, sin otro 'recibido' al comprador", async () => {
    pedidoParaCambiarMedio.mockResolvedValue({ entregaTipo: "retiro", pagoMetodo: "transferencia", lineas: [{ id: "1", qty: 2 }], avisosEnviados: true });
    const r = await llamar({ pagoMetodo: "mercadopago" });
    expect(r.status).toBe(200);
    expect(cambiarMedioPedido.mock.calls[0][2]).toMatchObject({ pagoMetodo: "mercadopago" });
    await Promise.all(despues.map((f) => f()));
    expect(avisarOperadorPedidoNuevo).toHaveBeenCalledWith("p1", { medioAnterior: "transferencia" });
    expect(avisarPedidoRecibido).not.toHaveBeenCalled();
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

describe("GET /api/pedidos/:id/medio", () => {
  it("devuelve las líneas, la entrega y el contacto del pedido para precargar el checkout", async () => {
    pedidoParaCambiarMedio.mockResolvedValue({
      entregaTipo: "retiro",
      pagoMetodo: "mercadopago",
      lineas: [],
      entrega: { local: "igz", ciudad: null, direccion: null },
      contacto: { nombre: "Ana", telefono: "3755000000" },
    });
    const r = await GET(new Request("https://tienda.example/api/pedidos/p1/medio"), { params: Promise.resolve({ id: "p1" }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      items: [],
      entrega: { tipo: "retiro", local: "igz", ciudad: null, direccion: null },
      contacto: { nombre: "Ana", telefono: "3755000000" },
    });
  });
});
