import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cotizacion } from "@/lib/cotizacion";
import type { ConfigEnvio } from "@/lib/envio";
import type { PromocionCupon } from "@/lib/cupones/tipos";
import { setFlag } from "@/test/flags";

/**
 * `POST /api/pedidos`, rama del invitado (change `compra-como-invitado`, S2a): guardas anti-abuso, datos
 * de facturación en línea, token de compra en la respuesta, CUIT/DNI que ya es de un contacto de
 * Alegra, cupones por email + IP, idempotencia y mails. Con sesión la rama no corre.
 */

const PED = "11111111-1111-4111-8111-111111111111";
const CLAVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRETO = "secreto-de-prueba-pedido-link-0123456789";

const crearPedido = vi.fn();
const getPedidoInvitadoPorClave = vi.fn();
const contarPendientesInvitado = vi.fn();
const verificarTurnstile = vi.fn();
const contactoExistenteEnAlegra = vi.fn();
const resolverCupon = vi.fn();
const permitirAsync = vi.fn();
const identidadActual = vi.fn();
const avisarPedidoSiFalta = vi.fn(async () => true);
const despues: (() => unknown)[] = [];
let config: ConfigEnvio = { domicilioActivo: true, gratis: null };

vi.mock("@/lib/rate-limit", () => ({ permitirAsync: (...a: unknown[]) => permitirAsync(...a) }));
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidadActual() }));
vi.mock("@/lib/pedido-avisos", () => ({
  avisoOperadorAlCrear: (m: string) => m !== "mercadopago",
  avisarPedidoSiFalta: (...a: unknown[]) => avisarPedidoSiFalta(...(a as [])),
  avisarPedidoRecibido: vi.fn(),
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (f: () => unknown) => {
    despues.push(f);
  },
}));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: async (): Promise<Cotizacion> => ({
    lineas: [{ id: "1", code: null, name: "x", brand: "", qty: 1, precioUnitario: 1000, ivaPorcentaje: 0, subtotal: 1000, iva: 0, total: 1000, stockDisponible: 5 }],
    hayProblemas: false, subtotal: 1000, iva: 0, costoEnvio: 0, total: 1000, listaPrivada: false, flujo: "normal",
  }),
}));
vi.mock("@/lib/pedidos", () => ({
  crearPedido: (...a: unknown[]) => crearPedido(...a),
  getPedidoPorClave: async () => null,
  getPedidoInvitadoPorClave: (...a: unknown[]) => getPedidoInvitadoPorClave(...a),
  contarPendientesInvitado: (...a: unknown[]) => contarPendientesInvitado(...a),
  formatearNumero: (n: number) => `PED-${String(n).padStart(8, "0")}`,
  listarPedidos: async () => [],
}));
vi.mock("@/lib/turnstile", () => ({
  turnstileConfigurado: () => true,
  verificarTurnstile: (...a: unknown[]) => verificarTurnstile(...a),
}));
vi.mock("@/lib/facturacion-db", () => ({
  contactoExistenteEnAlegra: (...a: unknown[]) => contactoExistenteEnAlegra(...a),
  getPerfilFacturacion: async () => null,
  perfilCompleto: () => false,
  guardarTelefonoSiFalta: vi.fn(),
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));
const mediosCrm = ["transferencia", "mercadopago"].map((slug, orden) => ({
  slug, nombre: slug === "transferencia" ? "Transferencia" : "Mercado Pago", instrucciones: "", activo: true, aplicaRetiro: true,
  aplicaEnvio: true, cobroOnline: slug === "mercadopago", orden,
}));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => mediosCrm }));
vi.mock("@/lib/sucursales-repo", async (orig) => ({
  ...(await orig<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: async () => config,
}));
vi.mock("@/lib/cupones/repo", async (orig) => ({
  ...(await orig<typeof import("@/lib/cupones/repo")>()),
  resolverCupon: (...a: unknown[]) => resolverCupon(...a),
}));

import { StockInsuficienteError } from "@/lib/stock-disponible";
import { verificarToken } from "@/lib/pedido-token";
import { POST } from "./route";

const ANONIMO = { clerkUserId: null, cliente: null, esAdmin: false, nombrePila: null };

function cuerpoBase(extra: Record<string, unknown> = {}) {
  return {
    items: [{ id: "1", qty: 1 }],
    contactoNombre: "Ana Prueba",
    contactoTelefono: "223 555 0100",
    entregaTipo: "envio",
    entregaCiudad: "Mar del Plata",
    entregaDireccion: "Calle Falsa 123",
    entregaProvincia: "Buenos Aires",
    pagoMetodo: "transferencia",
    idempotencyKey: CLAVE,
    email: "Ana@Cliente.example",
    emailConfirmacion: "ana@cliente.example",
    turnstile: "token-del-desafio",
    iniciado: String(Date.now() - 20_000),
    facturacionInvitado: { modo: "consumidor_final", nroDoc: "30.123.456", domicilioCp: "7600" },
    ...extra,
  };
}

function peticion(cuerpo: unknown, headers: Record<string, string> = {}, json = true) {
  return new Request("https://shop.example/api/pedidos", {
    method: "POST",
    headers: {
      origin: "https://shop.example",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "203.0.113.5",
      ...(json ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: JSON.stringify(cuerpo),
  });
}

const post = (extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => POST(peticion(cuerpoBase(extra), headers));

beforeEach(() => {
  vi.stubEnv("PEDIDO_LINK_SECRET", SECRETO);
  vi.stubEnv("SHOP_TENANT_ID", "tenant-a.example");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "clave-turnstile-de-prueba");
  setFlag("compra-invitado", true);
  config = { domicilioActivo: true, gratis: null };
  despues.length = 0;
  for (const f of [crearPedido, getPedidoInvitadoPorClave, contarPendientesInvitado, verificarTurnstile, contactoExistenteEnAlegra, resolverCupon, permitirAsync, identidadActual, avisarPedidoSiFalta]) f.mockReset();
  identidadActual.mockResolvedValue(ANONIMO);
  permitirAsync.mockResolvedValue(true);
  verificarTurnstile.mockResolvedValue({ ok: true });
  contarPendientesInvitado.mockResolvedValue(0);
  getPedidoInvitadoPorClave.mockResolvedValue(null);
  contactoExistenteEnAlegra.mockResolvedValue(null);
  crearPedido.mockImplementation(async () => ({ id: PED, numero: "PED-00000001", repetido: false, cuotas: null }));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("flag apagado: idéntico a hoy", () => {
  it("anónimo => 401 No autorizado, sin leer el cuerpo ni crear nada", async () => {
    setFlag("compra-invitado", false);
    const r = await post();
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
    expect(crearPedido).not.toHaveBeenCalled();
    expect(verificarTurnstile).not.toHaveBeenCalled();
  });
});

describe("guardas anti-abuso (antes de tocar la base)", () => {
  it("origen cruzado => 403", async () => {
    const r = await post({}, { "sec-fetch-site": "cross-site", origin: "https://malo.example" });
    expect(r.status).toBe(403);
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("Content-Type que no es JSON => 403", async () => {
    const r = await POST(peticion(cuerpoBase(), {}, false));
    expect(r.status).toBe(403);
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("honeypot lleno => 201 FALSO: ni pedido, ni mails, ni Turnstile", async () => {
    const r = await post({ sitio_web: "http://spam.example" });
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.id).toBeTruthy();
    expect(j.invitadoToken).toBeUndefined();
    expect(crearPedido).not.toHaveBeenCalled();
    expect(avisarPedidoSiFalta).not.toHaveBeenCalled();
    expect(despues).toHaveLength(0);
    expect(verificarTurnstile).not.toHaveBeenCalled();
  });

  it("llenado demasiado rápido => 201 falso, sin pedido", async () => {
    const r = await post({ iniciado: String(Date.now() - 300) });
    expect(r.status).toBe(201);
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("Turnstile ausente o rechazado => 400 con el texto de la spec", async () => {
    verificarTurnstile.mockResolvedValue({ ok: false, motivo: "sin_token" });
    const r = await post({ turnstile: undefined });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("No pudimos verificar la solicitud. Inténtelo nuevamente.");
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("exceso por IP => 429 en usted", async () => {
    permitirAsync.mockResolvedValue(false);
    const r = await post();
    expect(r.status).toBe(429);
    expect((await r.json()).error).toMatch(/^Hizo demasiados intentos/);
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("emails distintos => 400", async () => {
    const r = await post({ emailConfirmacion: "otra@cliente.example" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Los correos electrónicos no coinciden.");
  });

  it("falta el teléfono o es inválido => 400; falta el email => 400", async () => {
    expect((await post({ contactoTelefono: "" })).status).toBe(400);
    const corto = await post({ contactoTelefono: "123" });
    expect(corto.status).toBe(400);
    expect((await corto.json()).error).toBe("Ingrese un teléfono válido, con código de área.");
    expect((await post({ email: undefined, emailConfirmacion: undefined })).status).toBe(400);
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("factura A con CUIT de dígito verificador incorrecto => 400 en usted, sin pedido", async () => {
    const r = await post({
      facturacionInvitado: { modo: "factura_a", nroDoc: "30-71234567-2", razonSocial: "Empresa SA", condicionIva: "responsable_inscripto", domicilioCp: "7600" },
    });
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j).toMatchObject({ motivo: "facturacion_invalida", campos: expect.arrayContaining(["nroDoc"]) });
    expect(j.error).toMatch(/CUIT/);
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("sin datos de facturación => 400", async () => {
    expect((await post({ facturacionInvitado: undefined })).status).toBe(400);
  });

  it("tope de pendientes por email => 409 pendientes_tope en usted, sin reservar stock", async () => {
    contarPendientesInvitado.mockResolvedValue(3);
    const r = await post();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "pendientes_tope", error: expect.stringContaining("Pagar su pedido") });
    expect(contarPendientesInvitado.mock.calls[0][0]).toBe("ana@cliente.example");
    expect(crearPedido).not.toHaveBeenCalled();
  });
});

describe("creación del pedido de invitado", () => {
  it("201 con el token de compra del pedido (6 h, propósito compra) y el pedido nace de invitado", async () => {
    const antes = Date.now();
    const r = await post();
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j).toMatchObject({ id: PED, numero: "PED-00000001" });
    const v = verificarToken(j.invitadoToken, "compra");
    expect(v).toMatchObject({ ok: true, orderId: PED });
    expect(j.invitadoTokenVenceEn).toBe((v as { venceEn: number }).venceEn);
    expect(j.invitadoTokenVenceEn - antes).toBeGreaterThan(5.9 * 3600_000);
    expect(j.invitadoTokenVenceEn - antes).toBeLessThanOrEqual(6 * 3600_000 + 5_000);
    // Como link de pago NO sirve (propósitos separados).
    expect(verificarToken(j.invitadoToken, "pago")).toMatchObject({ ok: false, motivo: "proposito" });

    const [cliente, datos] = crearPedido.mock.calls[0];
    expect(cliente).toMatchObject({ clerkUserId: null, compraInvitado: true, email: "ana@cliente.example" });
    expect(cliente.codigo).toBeUndefined();
    expect(cliente.razonSocial).toBeUndefined();
    expect(datos).toMatchObject({
      contactoNombre: "Ana Prueba",
      contactoTelefono: "223 555 0100",
      requiereRevision: false,
      facturacion: {
        tipoDoc: "DNI",
        nroDoc: "30123456",
        razonSocial: "Ana Prueba",
        condicionIva: "consumidor_final",
        domicilio: "Calle Falsa 123, Mar del Plata, Buenos Aires, CP 7600",
      },
    });
  });

  it("factura A válida: se congela el CUIT, la razón social y la condición", async () => {
    const r = await post({
      facturacionInvitado: { modo: "factura_a", nroDoc: "30-71234567-1", razonSocial: "Empresa SA", condicionIva: "monotributo", domicilioCp: "7600" },
    });
    expect(r.status).toBe(201);
    expect(crearPedido.mock.calls[0][1].facturacion).toMatchObject({ tipoDoc: "CUIT", nroDoc: "30712345671", razonSocial: "Empresa SA", condicionIva: "monotributo" });
  });

  it("el body no puede traer lista, dueño ni precios: sólo cuenta lo que decide el servidor", async () => {
    await post({ clerkUserId: "user_otro", clienteCodigo: "C-1", codigo: "C-1", idPriceList: "L9", compraInvitado: false });
    const [cliente] = crearPedido.mock.calls[0];
    expect(cliente).toMatchObject({ clerkUserId: null, compraInvitado: true });
    expect(cliente.codigo).toBeUndefined();
    expect(cliente.idPriceList).not.toBe("L9");
  });

  it("stock insuficiente: el mismo error que para una cuenta (409 con la cotización) y SIN token", async () => {
    crearPedido.mockRejectedValue(new StockInsuficienteError(["1"]));
    const r = await post();
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error).toBe("Algunos productos cambiaron. Revise el detalle antes de confirmar.");
    expect(j.invitadoToken).toBeUndefined();
  });

  it("idempotencia: el reintento con los mismos datos devuelve el mismo pedido (200) y un token nuevo, sin pasar por Turnstile", async () => {
    getPedidoInvitadoPorClave.mockResolvedValue({ id: PED, numero: "PED-00000001", cuotas: null, cuentaPago: null });
    const r = await post();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ id: PED, repetido: true });
    expect(verificarToken(j.invitadoToken, "compra")).toMatchObject({ ok: true, orderId: PED });
    expect(getPedidoInvitadoPorClave).toHaveBeenCalledWith(CLAVE, "ana@cliente.example");
    expect(crearPedido).not.toHaveBeenCalled();
    expect(verificarTurnstile).not.toHaveBeenCalled();
  });

  it("idempotencia: una clave de OTRO invitado (otro email) no entrega ni número ni token", async () => {
    // El atajo no la encuentra (otro email), pero la base la tiene: crearPedido devuelve el pedido ajeno como repetido.
    crearPedido.mockResolvedValue({ id: PB_AJENO, numero: "PED-00000002", repetido: true, cuotas: null });
    const r = await post();
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.invitadoToken).toBeUndefined();
    expect(JSON.stringify(j)).not.toContain(PB_AJENO);
  });

  it("documento de un contacto de Alegra: lista general, sin vincular, para revisión; respuesta idéntica exista o no", async () => {
    const sin = await post();
    const sinJson = await sin.json();
    const datosSin = crearPedido.mock.calls[0];

    crearPedido.mockClear();
    contactoExistenteEnAlegra.mockResolvedValue("alegra-77");
    const con = await post();
    const conJson = await con.json();
    const datosCon = crearPedido.mock.calls[0];

    expect(contactoExistenteEnAlegra).toHaveBeenCalledWith("30123456");
    expect(datosCon[1]).toMatchObject({ requiereRevision: true, motivoRevision: "invitado_documento_en_alegra" });
    expect(datosSin[1]).toMatchObject({ requiereRevision: false, motivoRevision: null });
    // Ni vinculado ni lista privada: el comprador del pedido es el mismo en ambos casos.
    expect(datosCon[0]).toEqual(datosSin[0]);
    expect(datosCon[0].codigo).toBeUndefined();
    // La respuesta al invitado no revela nada (salvo el token, distinto por vencimiento).
    const sinToken = (j: Record<string, unknown>) => {
      const c = { ...j };
      delete c.invitadoToken;
      delete c.invitadoTokenVenceEn;
      return c;
    };
    expect(con.status).toBe(sin.status);
    expect(sinToken(conJson)).toEqual(sinToken(sinJson));
  });

  it("transferencia: el aviso al crear no sale (lo manda el aviso de irse de la pantalla o el cron, como hoy)", async () => {
    await post();
    expect(despues).toHaveLength(0);
    expect(avisarPedidoSiFalta).not.toHaveBeenCalled();
  });

  it("con pago en línea tampoco sale nada al crear: el mail y el aviso al local esperan al cobro", async () => {
    await post({ pagoMetodo: "mercadopago" });
    expect(despues).toHaveLength(0);
    expect(avisarPedidoSiFalta).not.toHaveBeenCalled();
  });

  it("no actualiza Alegra ni el perfil del invitado (no tiene)", async () => {
    await post();
    // Los `after` de sincronización con Alegra sólo se agendan para quien tiene contacto o perfil.
    expect(despues).toHaveLength(0);
  });
});

describe("cupones del invitado", () => {
  const promo = (o: Partial<PromocionCupon> = {}): PromocionCupon => ({
    codigoId: "c1", codigo: "LUZ-7KQ2M", promocionId: "p1", nombre: "Bot Instagram", tipo: "unicos", pct: 10,
    envioGratis: false, provinciasEnvio: null, inicio: "2026-01-01T00:00:00-03:00", fin: "2099-01-01T00:00:00-03:00",
    venceEn: null, soloPrimeraCompra: true, minimo: null, medios: null, formas: null, permiteCuotas: false,
    limiteCanjes: null, condiciones: "", activa: true, ...o,
  });

  it("se valida con el email normalizado del invitado (sin clerk_user_id) y el tope de consultas por IP; ya no revienta", async () => {
    resolverCupon.mockResolvedValue({ ok: true, promo: promo(), motivoCuenta: null, verificado: true });
    const claves: string[] = [];
    permitirAsync.mockImplementation(async (c: string) => {
      claves.push(c);
      return true;
    });
    const r = await post({ cupon: "luz 7kq2m", totalVisto: 900 });
    expect(r.status).toBe(201);
    const quien = { clerkUserId: null, email: "ana@cliente.example", listaPrivada: false, invitado: true };
    expect(resolverCupon).toHaveBeenCalledWith("luz 7kq2m", quien);
    expect(claves).toContain("cupon:ip:203.0.113.5");
    expect(crearPedido.mock.calls[0][1].cupon).toMatchObject({ promo: promo(), quien });
  });

  it("«una vez por cliente» con el mismo email => 409 con el mensaje del cupón en usted y sin pedido", async () => {
    resolverCupon.mockResolvedValue({
      ok: true,
      promo: promo(),
      motivoCuenta: "usado",
      verificado: true,
    });
    const r = await post({ cupon: "LUZ-7KQ2M", totalVisto: 900 });
    expect(r.status).toBe(409);
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("exceso de consultas por IP => el cupón sale no_disponible y no se lee la base", async () => {
    permitirAsync.mockImplementation(async (c: string) => !c.startsWith("cupon:"));
    const r = await post({ cupon: "LUZ-7KQ2M", totalVisto: 900 });
    expect(r.status).toBe(409);
    expect(resolverCupon).not.toHaveBeenCalled();
    expect((await r.json()).cotizacion.cuponError.motivo).toBe("no_disponible");
  });
});

describe("quien tiene sesión no usa la rama de invitado", () => {
  it("con sesión Clerk: no pasa por las guardas ni por Turnstile; los campos de invitado se ignoran", async () => {
    identidadActual.mockResolvedValue({ clerkUserId: "user_1", cliente: null, email: "ana@cliente.example" });
    setFlag("compra-invitado", false); // ni siquiera mira el flag
    // Sin facturación de perfil la cuenta recibe su 409 de siempre: prueba que corrió el camino de cuentas.
    const r = await POST(
      new Request("https://shop.example/api/pedidos", {
        method: "POST",
        body: JSON.stringify(cuerpoBase({ turnstile: undefined, iniciado: undefined })),
      }),
    );
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("facturacion_incompleta");
    expect(verificarTurnstile).not.toHaveBeenCalled();
    expect(contarPendientesInvitado).not.toHaveBeenCalled();
    expect(crearPedido).not.toHaveBeenCalled();
  });
});

const PB_AJENO = "22222222-2222-4222-8222-222222222222";
