import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Checkout de cuenta corriente (change `listas-cuenta-corriente`, rebanada D): para un comprador con
 * `tipoCuenta: "corriente"` el único medio aceptado es el de audiencia `cuenta_corriente`, validado
 * en el servidor con lo de ese momento. Sin cobro en línea ni cuotas; el pedido queda "a confirmar".
 * El público no puede pagar con ese medio. Fixtures sintéticas.
 */

const crearPedido = vi.fn();
const cotizar = vi.fn();
const cuotasHabilitadas = vi.fn(async () => true);

vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => true }));
vi.mock("@/lib/pedido-avisos", () => ({ avisoOperadorAlCrear: () => true, avisarPedidoRecibido: vi.fn(), avisarOperadorPedidoNuevo: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {},
}));

let identidad: Record<string, unknown> = {};
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => identidad,
  idPriceListCliente: async () => undefined,
}));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
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
// Contacto con facturación completa (vinculado o no): el foco acá es el medio de pago.
vi.mock("@/lib/datos-del-contacto", () => ({
  datosDelContacto: async () => ({
    fuente: "espejo",
    vinculado: true,
    alegraId: null,
    datos: { pais: "AR", tipoDoc: "CUIT", nroDoc: "30000000000", razonSocial: "Cliente Ejemplo SA", condicionIva: "RI" },
    bloqueados: [],
    faltantes: [],
    completo: true,
    motivoRevision: null,
    tipoDocDeducido: false,
    telefonos: null,
    telefonoAlegra: "1155550100",
    perfil: null,
    interno: null,
  }),
  paraElCliente: () => ({}),
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => cuotasHabilitadas() }));

let medios: unknown[] = [];
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => medios }));
vi.mock("@/lib/contacto-pedido-repo", () => ({
  contactoDelPedido: async () => ({ mensaje: "Nos comunicaremos.", horasHabiles: 24, whatsapp: null }),
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
  idListaPrecios: null,
  ...extra,
});

const CC = (extra: Record<string, unknown> = {}) =>
  medio("efectivo-cheque", { nombre: "Efectivo o cheque", audiencia: "cuenta_corriente", ...extra });

const COMPRADOR_CC = {
  clerkUserId: "user_1",
  email: "cc@cliente.example",
  cliente: { codigocliente: "C-1", razonsocial: "Cliente Ejemplo SA", tipoCuenta: "corriente", origen: "vinculacion" },
};
const COMPRADOR_CONTADO = {
  clerkUserId: "user_2",
  email: "ana@cliente.example",
  cliente: { codigocliente: "C-2", tipoCuenta: "contado", origen: "vinculacion" },
};
const COMPRADOR_PUBLICO = { clerkUserId: "user_3", email: "pub@cliente.example", cliente: null };

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
  vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token");
  vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-key");
  identidad = COMPRADOR_CC;
  medios = [medio("transferencia"), medio("mercadopago", { condicionesCuotas: [{ cuotas: 3, idListaPrecios: "9" }] }), CC()];
  cuotasHabilitadas.mockClear();
  cotizar.mockReset();
  cotizar.mockResolvedValue({
    lineas: [{ id: "1", qty: 1 }],
    hayProblemas: false,
    subtotal: 165289.26,
    iva: 34710.74,
    costoEnvio: 0,
    total: 200000,
  });
  crearPedido.mockReset();
  crearPedido.mockImplementation(async (_c, datos) => ({
    id: "p1",
    numero: "PED-00000001",
    repetido: false,
    cuotas: datos.cuotas ?? null,
  }));
});

describe("POST /api/pedidos — comprador con cuenta corriente", () => {
  it("acepta el medio de cuenta corriente: queda a confirmar, sin cuotas ni cobro", async () => {
    const r = await post({ pagoMetodo: "efectivo-cheque" });
    expect(r.status).toBe(201);
    const [, datos] = crearPedido.mock.calls[0];
    expect(datos.pagoMetodo).toBe("efectivo-cheque");
    expect(datos.cuotas ?? null).toBeNull();
    expect(datos).not.toHaveProperty("pagoProveedor");
    expect(datos).not.toHaveProperty("pagoEstado");
    expect(await r.json()).not.toHaveProperty("pagoEnLinea", true);
  });

  it("rechaza Mercado Pago, transferencia y a_coordinar (hay un medio de cuenta corriente activo)", async () => {
    for (const pagoMetodo of ["mercadopago", "transferencia", "a_coordinar", "xyz", ""]) {
      const r = await post({ pagoMetodo });
      expect(r.status, pagoMetodo).toBe(400);
      expect(await r.json()).toEqual({ error: NO_DISPONIBLE });
    }
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("ignora las cuotas del body: el pedido no las congela", async () => {
    const r = await post({ pagoMetodo: "efectivo-cheque", cuotas: 3 });
    expect(r.status).toBe(201);
    expect(crearPedido.mock.calls[0][1].cuotas ?? null).toBeNull();
    expect(cuotasHabilitadas).not.toHaveBeenCalled();
  });

  it("con el medio inactivo, el pedido queda a coordinar (y nada más vale)", async () => {
    medios = [medio("transferencia"), medio("mercadopago"), CC({ activo: false })];
    expect((await post({ pagoMetodo: "transferencia" })).status).toBe(400);
    expect((await post({ pagoMetodo: "efectivo-cheque" })).status).toBe(400);
    const ok = await post({ pagoMetodo: "a_coordinar" });
    expect(ok.status).toBe(201);
    expect(crearPedido.mock.calls[0][1].pagoMetodo).toBe("a_coordinar");
  });

  it("sin medio de cuenta corriente cargado también queda a coordinar", async () => {
    medios = [medio("transferencia"), medio("mercadopago")];
    expect((await post({ pagoMetodo: "mercadopago" })).status).toBe(400);
    expect((await post({ pagoMetodo: "a_coordinar" })).status).toBe(201);
  });

  it("rige también para envío a domicilio", async () => {
    const envio = { entregaTipo: "envio", entregaCiudad: "Puerto Iguazú", entregaDireccion: "Calle 1", entregaProvincia: "Misiones" };
    expect((await post({ pagoMetodo: "efectivo-cheque", ...envio })).status).toBe(201);
    expect((await post({ pagoMetodo: "transferencia", ...envio })).status).toBe(400);
  });

  it("sin tipo de cuenta lista (cuenta corriente sin lista enlazada) usa el mismo medio único", async () => {
    identidad = { ...COMPRADOR_CC, cliente: { ...COMPRADOR_CC.cliente, idPriceList: undefined } };
    expect((await post({ pagoMetodo: "efectivo-cheque" })).status).toBe(201);
    expect((await post({ pagoMetodo: "transferencia" })).status).toBe(400);
  });

  it("la cotización no recibe la lista del medio ni cuotas", async () => {
    await post({ pagoMetodo: "efectivo-cheque" });
    const opciones = cotizar.mock.calls.at(-1)![1];
    expect(opciones.idListaMedio).toBeUndefined();
  });
});

describe("POST /api/pedidos — quien no tiene cuenta corriente", () => {
  it.each([
    ["contado", COMPRADOR_CONTADO],
    ["sin vincular", COMPRADOR_PUBLICO],
  ])("%s: el medio de cuenta corriente se rechaza y los demás siguen como siempre", async (_n, id) => {
    identidad = id;
    const r = await post({ pagoMetodo: "efectivo-cheque" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: NO_DISPONIBLE });
    expect(crearPedido).not.toHaveBeenCalled();
    expect((await post({ pagoMetodo: "transferencia" })).status).toBe(201);
    expect((await post({ pagoMetodo: "mercadopago" })).status).toBe(201);
  });
});
