import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La validación del medio de pago la decide el server con lo de ESE momento (medios activos del CRM
 * releídos sin caché y credenciales de Mercado Pago), sin importar qué haya ofrecido la pantalla.
 * Sin flags: la tabla `medios_pago_shop` gobierna todo.
 */

const crearPedido = vi.fn();

// El límite por comprador se prueba en route.rate-limit.test.ts: acá los
// casos repiten el mismo usuario muchas veces.
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedido-avisos", () => ({ avisoOperadorAlCrear: () => true, avisarPedidoRecibido: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "ana@cliente.example" }),
}));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: async () => ({
    lineas: [{ id: "1", qty: 1 }],
    hayProblemas: false,
    subtotal: 165289.26,
    iva: 34710.74,
    costoEnvio: 0,
    total: 200000,
  }),
}));
vi.mock("@/lib/pedidos", () => ({
  // Cuenta de cobro del pedido creado (public key del Brick): sucursal igz.
  cuentaDelPedido: async () => ({ sucursal: "igz", facturaSucursal: null }),
  crearPedido: (...a: unknown[]) => crearPedido(...a),
  getPedidoPorClave: async () => null,
  listarPedidos: async () => [],
}));
vi.mock("@/lib/facturacion-db", () => ({
  getPerfilFacturacion: async () => ({ pais: "AR", tipoDoc: "DNI", nroDoc: "1", razonSocial: "X", condicionIva: "CF" }),
  perfilCompleto: () => true,
}));
// `@/lib/facturacion` es la real (`admiteEnvio` incluida): mockearla sería testear el mock.
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));

let medios: unknown[] = [];
const leerMedios = vi.fn(async () => medios);
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: () => leerMedios() }));
const contactoDelPedido = vi.fn();
vi.mock("@/lib/contacto-pedido-repo", () => ({
  contactoDelPedido: (...a: unknown[]) => contactoDelPedido(...a),
}));

import { POST } from "./route";

const NO_DISPONIBLE = "Ese medio de pago no está disponible para la entrega elegida.";

const medio = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  nombre: slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: slug === "mercadopago",
  orden: 0,
  ...extra,
});

const ENVIO = { entregaTipo: "envio", entregaCiudad: "Puerto Iguazú", entregaDireccion: "Calle 1", entregaProvincia: "Misiones" };

const post = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("http://localhost/api/pedidos", {
      method: "POST",
      body: JSON.stringify({
        items: [{ id: "1", qty: 1 }],
        contactoNombre: "Ana",
        contactoTelefono: "123",
        entregaTipo: "retiro",
        ...extra,
      }),
    }),
  );

const conCredenciales = () => {
  vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token");
  vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-key");
};

beforeEach(() => {
  medios = [];
  conCredenciales();
  leerMedios.mockClear();
  contactoDelPedido.mockReset();
  contactoDelPedido.mockResolvedValue({
    mensaje: "Nos comunicaremos dentro de las 24 horas hábiles.",
    horasHabiles: 24,
    whatsapp: { visible: "+54 9 11 5555-0100", url: "https://wa.me/5491155550100" },
  });
  crearPedido.mockReset();
  crearPedido.mockImplementation(async (_c, datos) => ({
    id: "p1",
    numero: "PED-00000001",
    repetido: false,
    cuotas: datos.cuotas ?? null,
  }));
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/pedidos — medios de la tabla", () => {
  it("acepta el slug de un medio activo que aplica y lo guarda tal cual, sin plan de cuotas", async () => {
    medios = [medio("transferencia"), medio("efectivo", { aplicaEnvio: false })];
    const r = await post({ pagoMetodo: "efectivo" });
    expect(r.status).toBe(201);
    expect(crearPedido.mock.calls[0][1].pagoMetodo).toBe("efectivo");
    expect(crearPedido.mock.calls[0][1].cuotas ?? null).toBeNull();
  });

  it("siempre relee los medios (sin caché)", async () => {
    medios = [medio("transferencia")];
    await post({ pagoMetodo: "transferencia" });
    expect(leerMedios).toHaveBeenCalledTimes(1);
  });

  it("rechaza un medio que no aplica a la modalidad, uno inactivo y uno inventado", async () => {
    medios = [medio("efectivo", { aplicaEnvio: false }), medio("transferencia"), medio("viejo", { activo: false })];
    for (const extra of [{ pagoMetodo: "efectivo", ...ENVIO }, { pagoMetodo: "viejo" }, { pagoMetodo: "xyz" }]) {
      const r = await post(extra);
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(await r.json()).toEqual({ error: NO_DISPONIBLE });
    }
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("un comprador sin cuenta corriente no puede pagar con el medio de audiencia cuenta_corriente", async () => {
    medios = [medio("transferencia"), medio("efectivo-cheque", { audiencia: "cuenta_corriente" })];
    const r = await post({ pagoMetodo: "efectivo-cheque" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: NO_DISPONIBLE });
    expect(crearPedido).not.toHaveBeenCalled();
    // Y si ese es el único medio cargado, sólo vale a_coordinar (no se filtra con su slug).
    medios = [medio("efectivo-cheque", { audiencia: "cuenta_corriente" })];
    expect((await post({ pagoMetodo: "efectivo-cheque" })).status).toBe(400);
    expect((await post({ pagoMetodo: "a_coordinar" })).status).toBe(201);
  });

  it("método faltante, vacío o basura: 400", async () => {
    medios = [medio("transferencia")];
    for (const extra of [{}, { pagoMetodo: "" }, { pagoMetodo: 7 }]) {
      const r = await post(extra);
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(await r.json()).toEqual({ error: NO_DISPONIBLE });
    }
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("a_coordinar sólo entra si ningún medio aplica a la modalidad", async () => {
    medios = [medio("efectivo", { aplicaEnvio: false })];
    expect((await post({ pagoMetodo: "efectivo", ...ENVIO })).status).toBe(400);
    const ok = await post({ pagoMetodo: "a_coordinar", ...ENVIO });
    expect(ok.status).toBe(201);
    const [, datos] = crearPedido.mock.calls[0];
    expect(datos.pagoMetodo).toBe("a_coordinar");
    expect(datos.cuotas ?? null).toBeNull();
    expect(datos).not.toHaveProperty("pagoProveedor");
  });

  it("a_coordinar se rechaza si hay medios aplicables", async () => {
    medios = [medio("transferencia")];
    expect((await post({ pagoMetodo: "a_coordinar" })).status).toBe(400);
  });

  it("tabla vacía o ausente: sólo a_coordinar", async () => {
    medios = [];
    expect((await post({ pagoMetodo: "a_coordinar" })).status).toBe(201);
    expect((await post({ pagoMetodo: "efectivo" })).status).toBe(400);
    expect((await post({ pagoMetodo: "mercadopago" })).status).toBe(400);
  });

  it("el body no puede colar datos de cobro", async () => {
    await post({
      pagoMetodo: "a_coordinar",
      pagoProveedor: "mercadopago",
      pagoReferencia: "123",
      pagoEstado: "pagado",
      cuotas: 12,
    });
    const [, datos] = crearPedido.mock.calls[0];
    expect(datos).not.toHaveProperty("pagoProveedor");
    expect(datos).not.toHaveProperty("pagoReferencia");
    expect(datos).not.toHaveProperty("pagoEstado");
    expect(datos.cuotas ?? null).toBeNull();
  });
});

describe("POST /api/pedidos — Mercado Pago", () => {
  it("activo, con credenciales y que aplica: se crea el pedido", async () => {
    medios = [medio("transferencia"), medio("mercadopago")];
    const r = await post({ pagoMetodo: "mercadopago" });
    expect(r.status).toBe(201);
    expect(crearPedido.mock.calls[0][1].pagoMetodo).toBe("mercadopago");
  });

  it("inactivo: 400 aunque haya credenciales", async () => {
    medios = [medio("transferencia"), medio("mercadopago", { activo: false })];
    const r = await post({ pagoMetodo: "mercadopago" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: NO_DISPONIBLE });
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("activo pero sin el access token de ninguna cuenta: 409 en usted, sin crear", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "");
    medios = [medio("transferencia"), medio("mercadopago")];
    const r = await post({ pagoMetodo: "mercadopago" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      error: "El medio de pago elegido no está disponible por el momento. Seleccione otro medio de pago.",
      motivo: "procesador_no_configurado",
    });
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("activo pero sin la public key de ninguna cuenta: 409", async () => {
    vi.stubEnv("MP_PUBLIC_KEY_IGZ", "");
    medios = [medio("transferencia"), medio("mercadopago")];
    expect((await post({ pagoMetodo: "mercadopago" })).status).toBe(409);
  });

  it("con una sola cuenta configurada (otra sucursal) se crea: la cuenta del pedido la decide el cobro", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "");
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token");
    vi.stubEnv("MP_PUBLIC_KEY_MDP", "TEST-key");
    medios = [medio("transferencia"), medio("mercadopago")];
    expect((await post({ pagoMetodo: "mercadopago" })).status).toBe(201);
  });

  it("las variables sin sufijo no cuentan: 409", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "");
    vi.stubEnv("MP_ACCESS_TOKEN", "TEST-token");
    medios = [medio("transferencia"), medio("mercadopago")];
    expect((await post({ pagoMetodo: "mercadopago" })).status).toBe(409);
  });

  it("sin credenciales y otro medio activo: el otro entra", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "");
    medios = [medio("transferencia"), medio("mercadopago")];
    expect((await post({ pagoMetodo: "transferencia" })).status).toBe(201);
  });

  it("sin credenciales y MP como único medio: sólo a_coordinar", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "");
    medios = [medio("mercadopago")];
    expect((await post({ pagoMetodo: "mercadopago" })).status).toBe(409);
    expect((await post({ pagoMetodo: "a_coordinar" })).status).toBe(201);
  });

  it("no aplica a la modalidad: 400", async () => {
    medios = [medio("transferencia"), medio("mercadopago", { aplicaEnvio: false })];
    expect((await post({ pagoMetodo: "mercadopago", ...ENVIO })).status).toBe(400);
  });
});

describe("POST /api/pedidos — contacto de la sucursal", () => {
  it("la respuesta siempre trae el contacto (plazo y WhatsApp de la sucursal del pedido)", async () => {
    medios = [medio("transferencia")];
    const r = await post({ pagoMetodo: "transferencia" });
    const json = await r.json();
    expect(contactoDelPedido).toHaveBeenCalledWith("p1", "PED-00000001");
    expect(json.contacto.mensaje).toBe("Nos comunicaremos dentro de las 24 horas hábiles.");
    expect(json.contacto.whatsapp.url).toBe("https://wa.me/5491155550100");
  });

  it("si el contacto no se puede armar, el pedido igual responde 201", async () => {
    medios = [medio("transferencia")];
    contactoDelPedido.mockResolvedValue(null);
    const r = await post({ pagoMetodo: "transferencia" });
    expect(r.status).toBe(201);
    expect(await r.json()).not.toHaveProperty("contacto");
  });
});
