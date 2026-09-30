import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Flag `pedido-a-confirmar`: con medios cargados en el CRM, `pago_metodo` es el slug de uno de ellos
 * aplicable a la modalidad (releídos sin caché); sin medios (tabla ausente o vacía) rige lo de
 * siempre; y la respuesta trae el plazo de contacto y el WhatsApp de la sucursal. Apagado, nada
 * de eso se lee.
 */

const crearPedido = vi.fn();
const getOferta = vi.fn();
let pagos = false;

// El límite por comprador se prueba en route.rate-limit.test.ts: acá los
// casos repiten el mismo usuario muchas veces.
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedido-avisos", () => ({ avisarPedidoRecibido: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "ana@cliente.example" }),
  idPriceListCliente: async () => undefined,
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
  crearPedido: (...a: unknown[]) => crearPedido(...a),
  getPedidoPorClave: async () => null,
  listarPedidos: async () => [],
}));
vi.mock("@/lib/facturacion-db", () => ({
  getPerfilFacturacion: async () => ({ pais: "AR", tipoDoc: "DNI", nroDoc: "1", razonSocial: "X", condicionIva: "CF" }),
  perfilCompleto: () => true,
}));
// `@/lib/facturacion` es la real (`admiteEnvio` incluida): mockearla sería testear el mock.
vi.mock("@/lib/cuotas-datos", () => ({ getOfertaCuotasParaPedido: () => getOferta() }));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: () => pagos }));

let medios: unknown[] = [];
const leerMedios = vi.fn(async () => medios);
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: () => leerMedios() }));
const contactoDelPedido = vi.fn();
vi.mock("@/lib/contacto-pedido-repo", () => ({
  contactoDelPedido: (...a: unknown[]) => contactoDelPedido(...a),
}));

import { POST } from "./route";
import { setFlag } from "@/test/flags";

const NO_DISPONIBLE = "Ese medio de pago no está disponible para la entrega elegida.";

const medio = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  nombre: slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 0,
  ...extra,
});

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

beforeEach(() => {
  setFlag("envio", true);
  pagos = false;
  medios = [];
  leerMedios.mockClear();
  contactoDelPedido.mockReset();
  contactoDelPedido.mockResolvedValue({
    mensaje: "Nos comunicaremos dentro de las 24 horas hábiles.",
    horasHabiles: 24,
    whatsapp: { visible: "+54 9 11 5555-0100", url: "https://wa.me/5491155550100" },
  });
  crearPedido.mockReset();
  crearPedido.mockImplementation(async () => ({ id: "p1", numero: "PED-00000001", repetido: false, cuotasMax: null }));
  getOferta.mockReset();
});

describe("POST /api/pedidos — flag pedido-a-confirmar APAGADO", () => {
  it("no lee medios ni contacto, y valida como siempre", async () => {
    medios = [medio("transferencia")];
    const r = await post({ pagoMetodo: "transferencia" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: NO_DISPONIBLE });
    expect(leerMedios).not.toHaveBeenCalled();

    const ok = await post({ pagoMetodo: "a_coordinar" });
    expect(ok.status).toBe(201);
    expect(contactoDelPedido).not.toHaveBeenCalled();
    expect(await ok.json()).not.toHaveProperty("contacto");
  });
});

describe("POST /api/pedidos — flag pedido-a-confirmar prendido", () => {
  beforeEach(() => setFlag("pedido-a-confirmar", true));

  it("acepta el slug de un medio del CRM y lo guarda tal cual", async () => {
    medios = [medio("transferencia"), medio("efectivo", { aplicaEnvio: false })];
    const r = await post({ pagoMetodo: "efectivo" });
    expect(r.status).toBe(201);
    expect(crearPedido.mock.calls[0][1].pagoMetodo).toBe("efectivo");
    // Sin cobro: no hay plan de cuotas ni se consulta la oferta.
    expect(crearPedido.mock.calls[0][3]).toBeNull();
    expect(getOferta).not.toHaveBeenCalled();
  });

  it("rechaza un medio que no aplica a la modalidad, uno inactivo y uno inventado", async () => {
    medios = [medio("efectivo", { aplicaEnvio: false }), medio("transferencia"), medio("viejo", { activo: false })];
    const envio = { entregaTipo: "envio", entregaCiudad: "Puerto Iguazú", entregaDireccion: "Calle 1" };
    for (const extra of [{ pagoMetodo: "efectivo", ...envio }, { pagoMetodo: "viejo" }, { pagoMetodo: "xyz" }]) {
      const r = await post(extra);
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(await r.json()).toEqual({ error: NO_DISPONIBLE });
    }
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("mercadopago y a_coordinar no entran con medios cargados: no hay cobro en línea", async () => {
    medios = [medio("transferencia"), medio("mercadopago")];
    pagos = true;
    for (const pagoMetodo of ["mercadopago", "a_coordinar"]) {
      expect((await post({ pagoMetodo })).status, pagoMetodo).toBe(400);
    }
  });

  it("un medio con cobro_online se trata como manual: sin plan de cuotas", async () => {
    medios = [medio("tarjeta", { cobroOnline: true })];
    const r = await post({ pagoMetodo: "tarjeta" });
    expect(r.status).toBe(201);
    expect(crearPedido.mock.calls[0][3]).toBeNull();
  });

  it("si ningún medio aplica a la modalidad, sólo entra a_coordinar", async () => {
    medios = [medio("efectivo", { aplicaEnvio: false })];
    const envio = { entregaTipo: "envio", entregaCiudad: "Puerto Iguazú", entregaDireccion: "Calle 1" };
    expect((await post({ pagoMetodo: "efectivo", ...envio })).status).toBe(400);
    expect((await post({ pagoMetodo: "a_coordinar", ...envio })).status).toBe(201);
  });

  it("FALLBACK: sin medios (tabla ausente o vacía) rigen las opciones fijas de siempre", async () => {
    medios = []; // leerMediosPagoTolerante devuelve [] si la tabla no existe
    expect((await post({ pagoMetodo: "a_coordinar" })).status).toBe(201);
    expect((await post({ pagoMetodo: "efectivo" })).status).toBe(400);
    pagos = true;
    getOferta.mockResolvedValue(null);
    expect((await post({ pagoMetodo: "transferencia" })).status).toBe(201);
    expect((await post({ pagoMetodo: "a_coordinar" })).status).toBe(400);
  });

  it("la respuesta trae el contacto (plazo y WhatsApp de la sucursal del pedido)", async () => {
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
