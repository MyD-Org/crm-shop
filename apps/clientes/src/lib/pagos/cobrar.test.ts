import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";
import { ErrorProveedor, type ProveedorPago } from "./tipos";

/**
 * `cobrarPedido` es genérica: el procesador sale del medio del pedido. Acá se fija lo que MP no
 * puede probar: un pedido de OTRO procesador no se cobra por éste, y el motivo del 409 sin
 * credenciales no menciona a MP.
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
const medios = vi.hoisted(() => ({ lista: null as null | { slug: string; opcionesCobro?: string[] }[] }));
vi.mock("@/lib/medios-pago-repo", () => ({
  leerMediosPagoTolerante: async () => medios.lista ?? [{ slug: "mercadopago" }, { slug: "payway" }],
}));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "a@cliente.example" }),
}));
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
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

import { cobrarPedido } from "./cobrar";

let configurado = true;
const otro: ProveedorPago = {
  id: "otroprocesador",
  configurado: () => configurado,
  crearPago: (...a: unknown[]) => crearPago(...a),
  consultarPago: async () => {
    throw new Error("no se usa");
  },
  cancelarPago: async () => {
    throw new Error("no se usa");
  },
};

const pagar = () =>
  cobrarPedido(
    otro,
    new Request("https://tienda.example/api/pagos/otroprocesador", {
      method: "POST",
      body: JSON.stringify({ pedidoId: "p1", token: "tok", cuotas: 1 }),
    }),
  );

const pedido = (pagoMetodo: string): PedidoParaPago => ({
  id: "p1", numero: "PED-1", total: 100, pagoEstado: "pendiente", pagoMetodo,
  clienteEmail: null, facturacionTipoDoc: null, facturacionNroDoc: null,
  cuotas: 1, estado: "pendiente", creadoEn: new Date(),
  contactoNombre: "Ana Gomez", contactoTelefono: "2235550100", entregaTipo: "retiro",
  entregaCiudad: null, entregaDireccion: null, facturacionDomicilio: null,
});

beforeEach(() => {
  configurado = true;
  for (const f of [registrarCobro, getPedidoParaPago, getItemsParaAntifraude, crearPago, fijarReferenciaIntento, cerrarIntentoSinPago, registrarIntentoFallido]) f.mockReset();
  orden.length = 0;
  medios.lista = null;
  for (const f of [fijarReferenciaIntento, cerrarIntentoSinPago, registrarIntentoFallido]) f.mockResolvedValue(undefined);
  crearPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "ok" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cobrarPedido — procesador genérico", () => {
  it("un pedido cuyo medio lo cobra OTRO procesador no se cobra por éste (mismo 404 que uno ajeno)", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("mercadopago")); // procesadorDeMedio = mercadopago ≠ otroprocesador
    const r = await pagar();
    expect(r.status).toBe(404);
    expect(crearPago).not.toHaveBeenCalled();
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it("sin credenciales → 409 con motivo genérico (no mp_no_configurado)", async () => {
    configurado = false;
    const r = await pagar();
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("procesador_no_configurado");
    expect(getPedidoParaPago).not.toHaveBeenCalled();
  });
});

/** Un procesador que conoce la referencia ANTES de cobrar y exige el BIN (Payway). */
const conReferencia = (): ProveedorPago & { requiereBin: boolean } => ({
  ...otro,
  id: "payway",
  requiereBin: true,
  referenciaDeIntento: (id: string) => `ref-${id}`,
});

const sinReferencia: ProveedorPago = { ...otro, id: "payway" };

const pagarCon = (p: ProveedorPago, body: Record<string, unknown> = {}) =>
  cobrarPedido(
    p,
    new Request("https://tienda.example/api/pagos/otroprocesador", {
      method: "POST",
      body: JSON.stringify({ pedidoId: "p1", token: "tok", cuotas: 1, bin: "450799", ...body }),
    }),
  );

describe("cobrarPedido — referencia del intento antes de cobrar", () => {
  beforeEach(() => {
    getPedidoParaPago.mockResolvedValue(pedido("payway"));
  });

  it("graba la referencia en el intento ANTES de llamar al procesador y le pasa intentoId y bin", async () => {
    fijarReferenciaIntento.mockImplementation(async () => void orden.push("fijar"));
    crearPago.mockImplementation(async () => {
      orden.push("crear");
      return { estado: "pagado", referencia: "ref-i1", detalle: "ok" };
    });
    const r = await pagarCon(conReferencia());
    expect(r.status).toBe(200);
    expect(orden).toEqual(["fijar", "crear"]);
    expect(fijarReferenciaIntento).toHaveBeenCalledWith("i1", "ref-i1");
    expect(crearPago).toHaveBeenCalledWith(expect.objectContaining({ intentoId: "i1", bin: "450799" }));
  });

  it("cobro aprobado pero falla registrarlo en la base: responde 'pagado' igual (no 'no pudimos procesar')", async () => {
    crearPago.mockResolvedValue({ estado: "pagado", referencia: "ref-i1", detalle: "ok" });
    registrarCobro.mockRejectedValue(new Error("DB caída"));
    const r = await pagarCon(conReferencia());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ estado: "pagado" });
    expect(registrarIntentoFallido).not.toHaveBeenCalled();
  });

  it("timeout o 5xx del procesador: el intento queda abierto CON referencia (no se descarta) para consultarlo", async () => {
    crearPago.mockRejectedValue(new ErrorProveedor("Payway respondió 503", 503));
    const r = await pagarCon(conReferencia());
    expect(r.status).toBe(502);
    expect(fijarReferenciaIntento).toHaveBeenCalledTimes(1);
    expect(cerrarIntentoSinPago).not.toHaveBeenCalled();
    expect(registrarIntentoFallido).toHaveBeenCalledWith("p1", expect.any(String), undefined);
  });

  it("rechazo del request (4xx): seguro que no hay pago, el intento se cierra aunque ya tenga referencia", async () => {
    crearPago.mockRejectedValue(new ErrorProveedor("Payway respondió 400", 400));
    const r = await pagarCon(conReferencia());
    expect(r.status).toBe(502);
    expect(cerrarIntentoSinPago).toHaveBeenCalledWith("i1", expect.any(String));
  });

  it("si no se puede grabar la referencia NO se cobra (sin ella un timeout podría duplicar el cobro)", async () => {
    fijarReferenciaIntento.mockRejectedValue(new Error("db caída"));
    const r = await pagarCon(conReferencia());
    expect(r.status).toBe(502);
    expect(crearPago).not.toHaveBeenCalled();
  });

  it("un procesador sin referenciaDeIntento (Mercado Pago) no toca la referencia del intento", async () => {
    await pagarCon(sinReferencia);
    expect(fijarReferenciaIntento).not.toHaveBeenCalled();
    expect(crearPago).toHaveBeenCalledWith(expect.not.objectContaining({ bin: expect.anything() }));
  });
});

describe("cobrarPedido — bin", () => {
  beforeEach(() => {
    getPedidoParaPago.mockResolvedValue(pedido("payway"));
  });

  it.each([[undefined], [""], ["12345"], ["1234567"], ["45079a"], [450799]])(
    "si el procesador lo requiere, un bin inválido (%j) corta con 400 antes de reservar o cobrar",
    async (bin) => {
      const r = await pagarCon(conReferencia(), { bin });
      expect(r.status).toBe(400);
      expect(crearPago).not.toHaveBeenCalled();
      expect(fijarReferenciaIntento).not.toHaveBeenCalled();
    },
  );

  it("si el procesador no lo requiere, el bin del body se ignora", async () => {
    await pagarCon(sinReferencia, { bin: "no-importa" });
    expect(crearPago).toHaveBeenCalledWith(expect.not.objectContaining({ bin: expect.anything() }));
  });
});

describe("cobrarPedido — datos del control de fraude", () => {
  const conAntifraude = (): ProveedorPago => ({ ...conReferencia(), requiereAntifraude: true });
  const items = [{ sku: "LED-9W", nombre: "Lampara LED", cantidad: 2, total: 100 }];

  beforeEach(() => {
    getPedidoParaPago.mockResolvedValue({
      ...pedido("payway"),
      clienteEmail: "comprador@cliente.example",
      entregaTipo: "envio",
      entregaCiudad: "Mar del Plata",
      entregaDireccion: "Calle Falsa 123",
    });
    getItemsParaAntifraude.mockResolvedValue(items);
  });

  it("arma los datos desde el pedido y la sesión (nunca del body) y se los pasa al procesador", async () => {
    const r = await pagarCon(conAntifraude(), { antifraude: { email: "intruso@cliente.example" }, monto: 1 });
    expect(r.status).toBe(200);
    expect(getItemsParaAntifraude).toHaveBeenCalledWith("p1");
    expect(crearPago).toHaveBeenCalledWith(
      expect.objectContaining({
        monto: 100,
        antifraude: expect.objectContaining({
          clienteId: "user_1",
          email: "comprador@cliente.example",
          nombre: "Ana Gomez",
          telefono: "2235550100",
          entrega: { tipo: "envio", ciudad: "Mar del Plata", direccion: "Calle Falsa 123" },
          items,
        }),
      }),
    );
  });

  it("sin productos o sin correo corta antes de reservar y de cobrar, con un mensaje en usted", async () => {
    getItemsParaAntifraude.mockResolvedValue([]);
    const r = await pagarCon(conAntifraude());
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/Revise su correo/);
    expect(fijarReferenciaIntento).not.toHaveBeenCalled();
    expect(crearPago).not.toHaveBeenCalled();
  });

  it("un procesador que no lo pide (Mercado Pago) no lee los productos ni recibe el bloque", async () => {
    await pagarCon(conReferencia());
    expect(getItemsParaAntifraude).not.toHaveBeenCalled();
    expect(crearPago.mock.calls[0][0]).not.toHaveProperty("antifraude");
  });
});

describe("cobrarPedido — forma de pago habilitada (migración 0073 del CRM)", () => {
  const mp = { ...otro, id: "mercadopago" };
  beforeEach(() => {
    getPedidoParaPago.mockResolvedValue(pedido("mercadopago"));
    reservarIntento.mockClear();
  });

  it("crédito deshabilitado: 422 en usted, sin reservar intento ni llamar al procesador", async () => {
    medios.lista = [{ slug: "mercadopago", opcionesCobro: ["debito", "cuenta_mp"] }];
    const r = await pagarCon(mp, { metodoPagoId: "visa" });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({
      error: "Esa forma de pago no está disponible para este medio. Elija otra forma de pago u otro medio de pago.",
      motivo: "opcion_no_habilitada",
    });
    expect(crearPago).not.toHaveBeenCalled();
    expect(reservarIntento).not.toHaveBeenCalled();
  });

  it("débito habilitado: se cobra normal", async () => {
    medios.lista = [{ slug: "mercadopago", opcionesCobro: ["debito"] }];
    const r = await pagarCon(mp, { metodoPagoId: "debvisa" });
    expect(r.status).toBe(200);
    expect(crearPago).toHaveBeenCalledTimes(1);
  });

  it("un id desconocido cuenta como crédito: con crédito deshabilitado se rechaza", async () => {
    medios.lista = [{ slug: "mercadopago", opcionesCobro: ["debito"] }];
    expect((await pagarCon(mp, { metodoPagoId: "marca-nueva" })).status).toBe(422);
    expect(crearPago).not.toHaveBeenCalled();
  });

  it("Payway: débito deshabilitado rechaza un id de débito", async () => {
    getPedidoParaPago.mockResolvedValue(pedido("payway"));
    medios.lista = [{ slug: "payway", opcionesCobro: ["credito"] }];
    expect((await pagarCon(conReferencia(), { metodoPagoId: "31" })).status).toBe(422);
    expect(crearPago).not.toHaveBeenCalled();
  });

  it("medio ausente o lectura fallida: 502, falla cerrado y no cobra", async () => {
    medios.lista = [];
    const r = await pagarCon(mp, { metodoPagoId: "visa" });
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe("No pudimos verificar el medio de pago. Inténtelo de nuevo en unos minutos.");
    expect(crearPago).not.toHaveBeenCalled();
    expect(reservarIntento).not.toHaveBeenCalled();
  });

  it("pedido ya pagado: responde pagado sin mirar las formas de pago", async () => {
    medios.lista = [{ slug: "mercadopago", opcionesCobro: [] }];
    getPedidoParaPago.mockResolvedValue({ ...pedido("mercadopago"), pagoEstado: "pagado" });
    const r = await pagarCon(mp, { metodoPagoId: "visa" });
    expect(await r.json()).toMatchObject({ estado: "pagado", yaEstaba: true });
  });
});
