import { afterEach, describe, expect, it, vi } from "vitest";
import { claveIdempotencia, crearMercadoPago, crearPreferencia, interpretar, modo3DS } from "./mercadopago";
import type { DatosPago } from "./tipos";

/**
 * Dos regresiones de bugs reales encontrados revisando este código antes de
 * mergearlo. Los dos habían pasado tsc, eslint, el build y 95 tests.
 */

const base: DatosPago = {
  pedidoId: "ped-1",
  monto: 1000,
  descripcion: "Pedido de prueba",
  medio: "tarjeta",
};

describe("claveIdempotencia", () => {
  /**
   * REGRESIÓN. La clave era `pedido-${pedidoId}`: la misma para todos los
   * intentos. Idempotencia en MP significa "misma clave, te devuelvo la
   * respuesta cacheada", así que un rechazo por fondos quedaba pegado y el
   * reintento con OTRA tarjeta recibía el mismo rechazo para siempre. El botón
   * "Probar de nuevo" del checkout no podía funcionar.
   */
  it("cambia cuando cambia la tarjeta", () => {
    const a = claveIdempotencia({ ...base, token: "token-tarjeta-1" });
    const b = claveIdempotencia({ ...base, token: "token-tarjeta-2" });
    expect(a).not.toBe(b);
  });

  /**
   * La otra mitad: dentro de un mismo intento tiene que ser estable, o un
   * reenvío del request cobra dos veces.
   */
  it("es estable para el mismo token", () => {
    const a = claveIdempotencia({ ...base, token: "token-tarjeta-1" });
    const b = claveIdempotencia({ ...base, token: "token-tarjeta-1" });
    expect(a).toBe(b);
  });

  it("distingue pedidos aunque el token se repitiera", () => {
    const a = claveIdempotencia({ ...base, pedidoId: "ped-1", token: "t" });
    const b = claveIdempotencia({ ...base, pedidoId: "ped-2", token: "t" });
    expect(a).not.toBe(b);
  });

  it("no filtra el token de la tarjeta dentro de la clave", () => {
    const clave = claveIdempotencia({ ...base, token: "token-secreto-abc123" });
    expect(clave).not.toContain("token-secreto-abc123");
  });

  it("sin token (dinero en cuenta) genera una clave distinta por intento", () => {
    const a = claveIdempotencia({ ...base, medio: "cuenta_mp" });
    const b = claveIdempotencia({ ...base, medio: "cuenta_mp" });
    expect(a).not.toBe(b);
  });
});

describe("interpretar", () => {
  it("traduce un pago acreditado", () => {
    const r = interpretar({
      id: 1001,
      status: "approved",
      status_detail: "accredited",
    });
    expect(r.estado).toBe("pagado");
    expect(r.referencia).toBe("1001");
    expect(r.motivo).toBeUndefined();
    expect(r.reversion).toBe(false);
  });

  it("traduce un rechazo con su motivo", () => {
    const r = interpretar({
      id: 1002,
      status: "rejected",
      status_detail: "insufficient_amount",
    });
    expect(r.estado).toBe("fallido");
    expect(r.motivo).toBe("fondos");
    // El detalle crudo se conserva: es lo único que sirve para diagnosticar
    // cuando un cliente llama.
    expect(r.detalle).toBe("insufficient_amount");
  });

  /**
   * REGRESIÓN. `reversion` se deducía AFUERA comparando contra `estado`
   * (nuestro vocabulario) y `detalle` (el status_detail). Ninguno de los dos
   * puede valer "charged_back", así que siempre daba false — y como
   * `transicionPermitida` bloquea pagado -> fallido salvo reversión, la plata
   * se iba y el pedido quedaba cobrado para siempre.
   */
  it("detecta un contracargo", () => {
    const r = interpretar({
      id: 1003,
      status: "charged_back",
      status_detail: "settled",
    });
    expect(r.reversion).toBe(true);
    expect(r.estado).toBe("fallido");
  });

  it("detecta una devolución", () => {
    expect(interpretar({ id: 1004, status: "refunded" }).reversion).toBe(true);
  });

  it("un fallo común NO es una reversión", () => {
    const r = interpretar({
      id: 1006,
      status: "rejected",
      status_detail: "bad_filled_card_data",
    });
    expect(r.reversion).toBe(false);
  });

  it("propaga el desafío 3DS", () => {
    const r = interpretar({
      id: 1007,
      status: "pending",
      status_detail: "pending_challenge",
      three_ds_info: { external_resource_url: "https://banco.test/acs", creq: "abc" },
    });
    expect(r.estado).toBe("pendiente");
    expect(r.desafio).toEqual({ externalResourceUrl: "https://banco.test/acs", creq: "abc" });
  });
});

import { urlNotificacion } from "./mercadopago";

describe("urlNotificacion", () => {
  it("arma la URL del webhook del entorno que creó el pago", () => {
    expect(urlNotificacion("https://www.cliente.example")).toBe(
      "https://www.cliente.example/api/pagos/mercadopago/webhook?source_news=webhooks",
    );
    expect(urlNotificacion("https://dev.cliente.example")).toBe(
      "https://dev.cliente.example/api/pagos/mercadopago/webhook?source_news=webhooks",
    );
  });

  /**
   * MP rechaza el pago ENTERO con 400 si `notification_url` es localhost. Mandarla
   * en desarrollo no solo no serviría: rompería el cobro local.
   */
  it("no la manda en local", () => {
    expect(urlNotificacion("http://localhost:3000")).toBeUndefined();
    expect(urlNotificacion("https://localhost:3000")).toBeUndefined();
    expect(urlNotificacion("http://127.0.0.1:3000")).toBeUndefined();
  });

  it("exige https", () => {
    expect(urlNotificacion("http://www.cliente.example")).toBeUndefined();
  });

  it("tolera un origen ausente o inválido", () => {
    expect(urlNotificacion(undefined)).toBeUndefined();
    expect(urlNotificacion("")).toBeUndefined();
    expect(urlNotificacion("no es una url")).toBeUndefined();
  });

  it("pide el formato Webhooks, que viene firmado", () => {
    expect(urlNotificacion("https://www.cliente.example")).toContain("source_news=webhooks");
  });
});

describe("interpretar — cuotas reales (L9)", () => {
  it("expone installments y transaction_details.total_paid_amount", () => {
    const r = interpretar({
      id: 2001,
      status: "approved",
      status_detail: "accredited",
      installments: 6,
      transaction_details: { total_paid_amount: 144000 },
    });
    expect(r.cuotasPagadas).toBe(6);
    expect(r.totalPagado).toBe(144000);
  });

  it("sin esos campos → undefined", () => {
    const r = interpretar({ id: 2002, status: "approved", status_detail: "accredited" });
    expect(r.cuotasPagadas).toBeUndefined();
    expect(r.totalPagado).toBeUndefined();
  });

  it("valores basura → undefined", () => {
    const r = interpretar({
      id: 2003,
      status: "approved",
      installments: 0,
      transaction_details: { total_paid_amount: Number.NaN },
    } as never);
    expect(r.cuotasPagadas).toBeUndefined();
    expect(r.totalPagado).toBeUndefined();
  });
});

describe("interpretar — pedido del pago (external_reference)", () => {
  it("expone el pedido que MP dice que tiene el pago", () => {
    const r = interpretar({ id: 9, status: "approved", external_reference: "pedido-1" });
    expect(r.pedidoId).toBe("pedido-1");
  });

  it("sin external_reference no inventa uno", () => {
    expect(interpretar({ id: 9, status: "approved" }).pedidoId).toBeUndefined();
    expect(interpretar({ id: 9, status: "approved", external_reference: null }).pedidoId).toBeUndefined();
  });
});

import { ErrorProveedor } from "./tipos";

describe("proveedor ligado a una cuenta: llamadas HTTP", () => {
  const fetchMock = vi.fn();
  const mdp = crearMercadoPago("mdp");

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockReset();
  });

  const conRespuesta = (status: number, cuerpo: unknown) => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token-mdp");
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token-igz");
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(cuerpo), { status }));
    vi.stubGlobal("fetch", fetchMock);
  };
  const autorizacion = (i = 0) => (fetchMock.mock.calls[i][1].headers as Record<string, string>).Authorization;

  it("cobra con el access token de SU cuenta, nunca con el de otra", async () => {
    conRespuesta(201, { id: 9, status: "approved", status_detail: "accredited" });
    await mdp.crearPago({ ...base, token: "tok" });
    expect(autorizacion()).toBe("Bearer TEST-token-mdp");
    await crearMercadoPago("igz").crearPago({ ...base, token: "tok" });
    expect(autorizacion(1)).toBe("Bearer TEST-token-igz");
  });

  it("consulta y cancela con la cuenta ligada", async () => {
    conRespuesta(200, { id: 7, status: "cancelled", status_detail: "by_collector" });
    await mdp.consultarPago("7");
    const r = await mdp.cancelarPago("7");
    expect(autorizacion(0)).toBe("Bearer TEST-token-mdp");
    expect(autorizacion(1)).toBe("Bearer TEST-token-mdp");
    expect(r.estado).toBe("fallido");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.mercadopago.com/v1/payments/7");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ status: "cancelled" });
  });

  it("cuenta sin credenciales: error explícito SIN llamar a Mercado Pago (ni con otra cuenta)", async () => {
    conRespuesta(201, {});
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "");
    await expect(mdp.crearPago({ ...base, token: "tok" })).rejects.toThrow(/mdp/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un error HTTP conserva el status, para distinguir un 404 de una caída", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    conRespuesta(404, { message: "not found" });
    const err = await mdp.consultarPago("123").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErrorProveedor);
    expect((err as ErrorProveedor).status).toBe(404);
  });

  it("urlNotificacion del proveedor lleva la cuenta como pista", () => {
    expect(mdp.urlNotificacion?.("https://tienda.example")).toBe(
      "https://tienda.example/api/pagos/mercadopago/webhook?source_news=webhooks&cuenta=mdp",
    );
  });
});

describe("configurado() por cuenta", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("exige el Access Token y la Public Key de esa cuenta", () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token");
    vi.stubEnv("MP_PUBLIC_KEY_MDP", "TEST-key");
    expect(crearMercadoPago("mdp").configurado()).toBe(true);
    expect(crearMercadoPago("igz").configurado()).toBe(false);
  });
  it("sin Access Token no está configurado", () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "");
    vi.stubEnv("MP_PUBLIC_KEY_MDP", "TEST-key");
    expect(crearMercadoPago("mdp").configurado()).toBe(false);
  });
  it("sin Public Key no está configurado", () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token");
    vi.stubEnv("MP_PUBLIC_KEY_MDP", "");
    expect(crearMercadoPago("mdp").configurado()).toBe(false);
  });
});

describe("crearPreferencia", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const pref = {
    items: [{ id: "p", title: "Pedido", quantity: 1 as const, unit_price: 10, currency_id: "ARS" as const }],
    external_reference: "p",
    purpose: "wallet_purchase" as const,
    payment_methods: { installments: 1, excluded_payment_methods: [{ id: "consumer_credits" }] },
  };

  it("hace POST a /checkout/preferences con el Access Token de la cuenta y devuelve el link (init_point)", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token-mdp");
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token-igz");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "pref-9", init_point: "https://x.example" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(crearPreferencia("mdp", pref)).resolves.toBe("https://x.example");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/checkout/preferences");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TEST-token-mdp");
    expect(JSON.parse(init.body as string).purpose).toBe("wallet_purchase");
  });

  it("sin link de pago en la respuesta, falla", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 201 })));
    await expect(crearPreferencia("mdp", pref)).rejects.toThrow();
  });

  it("cuenta sin access token: falla sin llamar a Mercado Pago", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(crearPreferencia("mdp", pref)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("interpretar — medio con el que se cobró (info)", () => {
  it("tarjeta: marca, tipo, últimos 4, fecha y autorización; nunca titular ni BIN", () => {
    const e = interpretar({
      id: 1,
      status: "approved",
      payment_type_id: "credit_card",
      payment_method_id: "master",
      card: { last_four_digits: "4623", first_six_digits: "548392", cardholder: { name: "APRO" } } as never,
      date_approved: "2026-10-07T15:30:00.000-04:00",
      authorization_code: "123456",
    });
    expect(e.info).toEqual({
      tipo: "credito",
      marca: "Mastercard",
      ultimos4: "4623",
      aprobadoEn: "2026-10-07T19:30:00.000Z",
      autorizacion: "123456",
    });
    expect(JSON.stringify(e.info)).not.toMatch(/548392|APRO/);
  });

  it("débito con id propio de MP (debvisa) → Visa débito", () => {
    const e = interpretar({ id: 2, status: "approved", payment_type_id: "debit_card", payment_method_id: "debvisa" });
    expect(e.info).toEqual({ tipo: "debito", marca: "Visa" });
  });

  it("dinero en cuenta: sin marca", () => {
    const e = interpretar({ id: 3, status: "approved", payment_type_id: "account_money", payment_method_id: "account_money" });
    expect(e.info).toEqual({ tipo: "dinero_en_cuenta" });
  });

  it("sin datos del medio: no agrega info; últimos 4 inválidos se descartan", () => {
    expect(interpretar({ id: 4, status: "approved" }).info).toBeUndefined();
    expect(interpretar({ id: 5, status: "approved", card: { last_four_digits: "12" } }).info).toBeUndefined();
  });

  it("una marca desconocida se guarda con su id", () => {
    expect(interpretar({ id: 6, status: "approved", payment_method_id: "nuevamarca" }).info).toEqual({ marca: "nuevamarca" });
  });
});

describe("interpretar — neto que recibe la tienda y cargos de Mercado Pago", () => {
  it("neto informado: costo = monto − neto (comisión + costo de las cuotas sin interés)", () => {
    const e = interpretar({
      id: 7,
      status: "approved",
      transaction_amount: 10000,
      transaction_details: { total_paid_amount: 10000, net_received_amount: 8790.35 },
      fee_details: [
        { type: "mercadopago_fee", amount: 761, fee_payer: "collector" },
        { type: "financing_fee", amount: 448.65, fee_payer: "collector" },
      ],
    });
    expect(e.info).toEqual({ netoRecibido: 8790.35, costoProcesador: 1209.65 });
  });

  it("cuotas con interés del comprador: el interés no cuenta como costo de la tienda", () => {
    const e = interpretar({
      id: 8,
      status: "approved",
      transaction_amount: 10000,
      transaction_details: { total_paid_amount: 12100, net_received_amount: 9239 },
      fee_details: [
        { type: "mercadopago_fee", amount: 761, fee_payer: "collector" },
        { type: "financing_fee", amount: 2100, fee_payer: "payer" },
      ],
    });
    expect(e.info).toEqual({ netoRecibido: 9239, costoProcesador: 761 });
  });

  it("sin monto: el costo sale de los cargos que paga el vendedor", () => {
    const e = interpretar({
      id: 9,
      status: "approved",
      transaction_details: { net_received_amount: 9239 },
      fee_details: [
        { type: "mercadopago_fee", amount: 761, fee_payer: "collector" },
        { type: "financing_fee", amount: 2100, fee_payer: "payer" },
      ],
    });
    expect(e.info).toEqual({ netoRecibido: 9239, costoProcesador: 761 });
  });

  it("pago sin aprobar (MP informa neto 0) o sin el dato: no se guarda nada", () => {
    expect(
      interpretar({ id: 10, status: "pending", transaction_amount: 10000, transaction_details: { net_received_amount: 0 } }).info,
    ).toBeUndefined();
    expect(interpretar({ id: 11, status: "approved", transaction_amount: 10000, fee_details: [] }).info).toBeUndefined();
  });
});

describe("modo3DS", () => {
  it("obligatorio sólo para compras de MÁS de $300.000; opcional hasta ese monto", () => {
    expect(modo3DS(300_000.01)).toBe("mandatory");
    expect(modo3DS(1_200_000)).toBe("mandatory");
    expect(modo3DS(300_000)).toBe("optional");
    expect(modo3DS(95_956.58)).toBe("optional");
  });
});
