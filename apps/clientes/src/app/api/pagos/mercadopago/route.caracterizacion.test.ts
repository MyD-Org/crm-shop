import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";
import { ErrorProveedor } from "@/lib/pagos/tipos";

/**
 * CARACTERIZACIÓN del cobro con Mercado Pago (rebanada A de payway-cobro).
 *
 * Se escribió ANTES de generalizar el procesador y fija el comportamiento observable de
 * `POST /api/pagos/mercadopago`: códigos, cuerpos y llamadas al proveedor. Tiene que pasar igual
 * antes y después del refactor; si hay que tocar un assert, el refactor cambió el comportamiento.
 */

const crearPago = vi.fn();
const registrarCobro = vi.fn();
const registrarIntentoFallido = vi.fn();
const reservarIntento = vi.fn();
const getPedidoParaPago = vi.fn();
let identidad: {
  clerkUserId: string | null;
  cliente: { codigocliente: string; email?: string } | null;
  email: string | null;
};
let permitido = true;
let configurado = true;

// Formas de pago del medio (migración 0073 del CRM): sin dato = todas las de su procesador.
vi.mock("@/lib/medios-pago-repo", () => ({
  leerMediosPagoTolerante: async () => [{ slug: "mercadopago" }, { slug: "payway" }],
}));
vi.mock("@/lib/auth", () => ({ identidadActual: async () => identidad }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => permitido }));
vi.mock("@/lib/pedidos", async (original) => ({
  cuentasRechazadasDelPedido: async () => [],
  detalleCredencialesRechazadas: (c: string) => `credenciales_rechazadas:${c}`,
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  reservarIntento: (...a: unknown[]) => reservarIntento(...a),
  getPedidoParaPago: (...a: unknown[]) => getPedidoParaPago(...a),
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
  registrarIntentoFallido: (...a: unknown[]) => registrarIntentoFallido(...a),
}));
vi.mock("@/lib/pagos/intento-abierto", () => ({ resolverIntentoAbierto: async () => "en_curso" }));
// Proveedor de Mercado Pago ligado a la cuenta del pedido: un doble. La elección de la cuenta se prueba
// en lib/pagos/cobrar.cuenta.test.ts; acá la cuenta es "igz" y está configurada según el test.
vi.mock("@/lib/pagos/mercadopago", async (orig) => ({
  ...(await orig<typeof import("@/lib/pagos/mercadopago")>()),
  crearMercadoPago: (cuenta: string) => ({
    id: "mercadopago",
    cuenta,
    configurado: () => configurado,
    urlNotificacion: (origen: string) => `${origen}/api/pagos/mercadopago/webhook`,
    crearPago: (...a: unknown[]) => crearPago(...a),
    consultarPago: async () => {
      throw new Error("no se usa");
    },
    cancelarPago: async () => {
      throw new Error("no se usa");
    },
  }),
}));
vi.mock("@/lib/pagos/credenciales", async (orig) => ({
  ...(await orig<typeof import("@/lib/pagos/credenciales")>()),
  hayCuentaConfigurada: () => configurado,
}));
vi.mock("@/lib/pagos/cuentas-sucursales", () => ({
  cuentaParaCobrar: async () =>
    (() => configurado)() ? { ok: true, cuenta: "igz", prevista: "igz", fallback: false } : { ok: false, motivo: "sin_cuenta" },
  proveedorDeIntento: async () => null,
}));
import { POST } from "./route";

const pagar = (body: unknown, crudo?: string) =>
  POST(
    new Request("https://tienda.example/api/pagos/mercadopago", {
      method: "POST",
      body: crudo ?? JSON.stringify(body),
    }),
  );

const base = { pedidoId: "p1", medio: "tarjeta", token: "tok", cuotas: 1, metodoPagoId: "visa" };

const pedidoBase = (extra: Partial<PedidoParaPago> = {}): PedidoParaPago => ({
  id: "p1",
  numero: "PED-1",
  total: 100,
  pagoEstado: "pendiente",
  pagoMetodo: "mercadopago",
  clienteEmail: "pedido@cliente.example",
  facturacionTipoDoc: "DNI",
  facturacionNroDoc: "30111222",
  cuotas: 1,
  estado: "pendiente",
  creadoEn: new Date(),
  ...extra,
});

beforeEach(() => {
  for (const f of [crearPago, registrarCobro, registrarIntentoFallido, reservarIntento, getPedidoParaPago]) {
    f.mockReset();
  }
  identidad = { clerkUserId: "user_1", cliente: null, email: "sesion@cliente.example" };
  permitido = true;
  configurado = true;
  reservarIntento.mockResolvedValue({ intentoId: "i1" });
  registrarIntentoFallido.mockResolvedValue(undefined);
  registrarCobro.mockResolvedValue(true);
  crearPago.mockResolvedValue({
    estado: "pagado",
    referencia: "r1",
    detalle: "accredited",
    cuotasPagadas: 1,
    totalPagado: 100,
  });
  getPedidoParaPago.mockResolvedValue(pedidoBase());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/pagos/mercadopago — caracterización", () => {
  it("sin sesión → 401 sin leer nada", async () => {
    identidad = { clerkUserId: null, cliente: null, email: null };
    const r = await pagar(base);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
    expect(getPedidoParaPago).not.toHaveBeenCalled();
  });

  it("sin credenciales → 409 mp_no_configurado", async () => {
    configurado = false;
    const r = await pagar(base);
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("mp_no_configurado");
    expect(getPedidoParaPago).not.toHaveBeenCalled();
  });

  it("rate limit → 429", async () => {
    permitido = false;
    const r = await pagar(base);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "Demasiados intentos de pago. Espere unos minutos." });
  });

  it("body inválido → 400; sin pedido → 400; tarjeta sin token → 400", async () => {
    expect((await pagar(null, "no-json")).status).toBe(400);
    const sinPedido = await pagar({ ...base, pedidoId: " " });
    expect(sinPedido.status).toBe(400);
    expect(await sinPedido.json()).toEqual({ error: "Falta el pedido." });
    const sinToken = await pagar({ ...base, token: "" });
    expect(sinToken.status).toBe(400);
    expect(await sinToken.json()).toEqual({ error: "Falta el token de la tarjeta." });
    expect(getPedidoParaPago).not.toHaveBeenCalled();
  });

  it("pedido ajeno/inexistente → 404 y la consulta filtra por dueño", async () => {
    getPedidoParaPago.mockResolvedValue(null);
    const r = await pagar(base);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "No encontramos ese pedido." });
    expect(getPedidoParaPago).toHaveBeenCalledWith("p1", { clerkUserId: "user_1", clienteCodigo: undefined });
  });

  it("pedido ya pagado → { estado: pagado, yaEstaba } sin cobrar", async () => {
    getPedidoParaPago.mockResolvedValue(pedidoBase({ pagoEstado: "pagado" }));
    const r = await pagar(base);
    expect(await r.json()).toEqual({ estado: "pagado", yaEstaba: true });
    expect(crearPago).not.toHaveBeenCalled();
  });

  it("pedido vencido → 409 pedido_no_cobrable sin tocar al proveedor", async () => {
    getPedidoParaPago.mockResolvedValue(pedidoBase({ creadoEn: new Date(Date.now() - 400 * 24 * 60 * 60_000) }));
    const r = await pagar(base);
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("pedido_no_cobrable");
    expect(crearPago).not.toHaveBeenCalled();
    expect(reservarIntento).not.toHaveBeenCalled();
  });

  it("cobro aprobado: reserva el intento con el id del proveedor y arma el pago desde el pedido", async () => {
    const r = await pagar({ ...base, monto: 1 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: "pagado", reintentable: false, referencia: "r1" });
    expect(reservarIntento).toHaveBeenCalledWith("p1", "mercadopago", "tarjeta", {
      cuotas: 1,
      totalEsperado: 100,
      conInteres: false,
    }, expect.objectContaining({ cuenta: expect.any(String) }));
    expect(crearPago).toHaveBeenCalledWith({
      pedidoId: "p1",
      monto: 100,
      descripcion: "Pedido PED-1 — Central LED",
      urlNotificacion: "https://tienda.example/api/pagos/mercadopago/webhook",
      medio: "tarjeta",
      token: "tok",
      cuotas: 1,
      metodoPagoId: "visa",
      emailComprador: "pedido@cliente.example",
      tipoDocumento: "DNI",
      numeroDocumento: "30111222",
    });
    expect(registrarCobro).toHaveBeenCalledWith(
      "p1",
      {
        proveedor: "mercadopago",
        referencia: "r1",
        estado: "pagado",
        detalle: "accredited",
        medio: "tarjeta",
        cuotas: 1,
        totalPagado: 100,
      },
      { intentoId: "i1" },
    );
  });

  it("sin email en el pedido usa el de la sesión; documento no argentino no se manda", async () => {
    getPedidoParaPago.mockResolvedValue(
      pedidoBase({ clienteEmail: null, facturacionTipoDoc: "RUC", facturacionNroDoc: "123" }),
    );
    await pagar(base);
    const datos = crearPago.mock.calls[0][0];
    expect(datos.emailComprador).toBe("sesion@cliente.example");
    expect(datos).not.toHaveProperty("tipoDocumento");
    expect(datos).not.toHaveProperty("numeroDocumento");
  });

  it("pago rechazado: devuelve motivo traducido, mensaje y reintentable (nunca el status crudo)", async () => {
    crearPago.mockResolvedValue({
      estado: "fallido",
      referencia: "r2",
      detalle: "cc_rejected_bad_filled_other",
      motivo: "datos_invalidos",
    });
    const r = await pagar(base);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      estado: "fallido",
      motivo: "datos_invalidos",
      mensaje: "Revise el número, la fecha de vencimiento y el código de seguridad.",
      reintentable: true,
      referencia: "r2",
    });
  });

  it("desafío 3DS pendiente: se devuelve para renderizarlo", async () => {
    const desafio = { externalResourceUrl: "https://banco.example/3ds", creq: "abc" };
    crearPago.mockResolvedValue({ estado: "pendiente", referencia: "r3", detalle: "pending_challenge", desafio });
    const r = await pagar(base);
    expect((await r.json()).desafio).toEqual(desafio);
  });

  it("el proveedor tira 4xx → 502 en usted y la reserva se cierra", async () => {
    crearPago.mockRejectedValue(new ErrorProveedor("bad request", 400));
    const r = await pagar(base);
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "No pudimos procesar el pago. Inténtelo de nuevo en un momento." });
    expect(registrarIntentoFallido).toHaveBeenCalledWith("p1", "bad request", "i1");
  });

  it("no existe reserva (pedido desaparecido) → 404", async () => {
    reservarIntento.mockResolvedValue(null);
    expect((await pagar(base)).status).toBe(404);
    expect(crearPago).not.toHaveBeenCalled();
  });
});
