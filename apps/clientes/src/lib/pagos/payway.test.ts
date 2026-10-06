import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import aprobado from "./__fixtures__/payway/pago-aprobado.json";
import rechazado51 from "./__fixtures__/payway/pago-rechazado-51.json";
import listadoUnPago from "./__fixtures__/payway/listado-un-pago.json";
import listadoVacio from "./__fixtures__/payway/listado-vacio.json";
import pagoAnulado from "./__fixtures__/payway/pago-anulado.json";
import error400 from "./__fixtures__/payway/error-400.json";
import error401 from "./__fixtures__/payway/error-401.json";
import error403 from "./__fixtures__/payway/error-403.json";
import error404 from "./__fixtures__/payway/error-404.json";
import { crearPayway, paywayConfigPublica } from "./payway";
import { ErrorProveedor, type DatosPago } from "./tipos";
import { referenciaDeIntento } from "./payway-estados";

// Valores de relleno: nada de credenciales reales.
const KEY_PRIVADA = "clave-privada-de-prueba";
const KEY_PUBLICA = "clave-publica-de-prueba";
const BASE = "https://payway.example";

// Con este id el site_transaction_id coincide con el de los fixtures (Payway devuelve el que mandamos).
const INTENTO = "01234567-89ab-cdef-0123-456789abcdef";
const REF = referenciaDeIntento(INTENTO);

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const abortError = () => Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });

const datos = (extra: Partial<DatosPago> = {}): DatosPago => ({
  pedidoId: "pedido-1",
  monto: 10,
  descripcion: "Pedido PED-1",
  medio: "tarjeta",
  token: "00000000-0000-4000-8000-000000000001",
  cuotas: 1,
  metodoPagoId: "1",
  bin: "450799",
  intentoId: INTENTO,
  ...extra,
});

const fetchMock = vi.fn();
const pausa = vi.fn(async () => {});
const payway = crearPayway({ fetch: fetchMock as unknown as typeof fetch, pausa });

const llamadas = () =>
  (fetchMock.mock.calls as [string, RequestInit | undefined][]).map(([url, init]) => ({
    url,
    metodo: init?.method ?? "GET",
    headers: init?.headers as Record<string, string>,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  }));

beforeEach(() => {
  fetchMock.mockReset();
  pausa.mockClear();
  vi.stubEnv("PAYWAY_API_PRIVATE_KEY", KEY_PRIVADA);
  vi.stubEnv("PAYWAY_API_PUBLIC_KEY", KEY_PUBLICA);
  vi.stubEnv("PAYWAY_BASE_URL", BASE);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("paywayConfigPublica()", () => {
  it("entrega la key PÚBLICA y la base (para tokenizar en el navegador), nunca la privada", () => {
    const c = paywayConfigPublica();
    expect(c).toEqual({ publicKey: KEY_PUBLICA, baseUrl: BASE });
    expect(JSON.stringify(c)).not.toContain(KEY_PRIVADA);
  });

  it("normaliza la base (sin barra final ni /api/v2)", () => {
    vi.stubEnv("PAYWAY_BASE_URL", `${BASE}/api/v2/`);
    expect(paywayConfigPublica()?.baseUrl).toBe(BASE);
  });

  it("null si el medio no está configurado (falta cualquiera de las tres)", () => {
    for (const nombre of ["PAYWAY_API_PRIVATE_KEY", "PAYWAY_API_PUBLIC_KEY", "PAYWAY_BASE_URL"]) {
      vi.stubEnv(nombre, "");
      expect(paywayConfigPublica()).toBeNull();
      vi.stubEnv(nombre, nombre.includes("BASE") ? BASE : "placeholder");
    }
  });
});

describe("configurado()", () => {
  it("sólo con la key pública, la privada y una base https", () => {
    expect(payway.configurado()).toBe(true);
    for (const [nombre, valor] of [
      ["PAYWAY_API_PRIVATE_KEY", ""],
      ["PAYWAY_API_PUBLIC_KEY", ""],
      ["PAYWAY_BASE_URL", ""],
      ["PAYWAY_BASE_URL", "http://payway.example"],
      ["PAYWAY_BASE_URL", "no es una url"],
    ] as const) {
      vi.stubEnv(nombre, valor);
      expect(payway.configurado()).toBe(false);
      vi.stubEnv(nombre, nombre.includes("BASE") ? BASE : "placeholder");
    }
  });

  it("no ofrece webhook ni URL de notificación (Payway no los documenta)", () => {
    expect(payway.verificarWebhook).toBeUndefined();
    expect(payway.urlNotificacion).toBeUndefined();
  });

  it("exige el BIN y conoce la referencia del pago antes de crearlo", () => {
    expect(payway.requiereBin).toBe(true);
    expect(payway.referenciaDeIntento?.(INTENTO)).toBe(REF);
  });
});

describe("crearPago — request", () => {
  it("POST /payments con el monto en centavos, la key privada y el site_transaction_id del intento", async () => {
    fetchMock.mockImplementation(async () => json(201, aprobado));
    await payway.crearPago(datos({ monto: 1234.56, cuotas: 3, descripcion: "x".repeat(300) }));

    const [c] = llamadas();
    expect(c.url).toBe(`${BASE}/api/v2/payments`);
    expect(c.metodo).toBe("POST");
    expect(c.headers.apikey).toBe(KEY_PRIVADA);
    expect(c.headers["Content-Type"]).toBe("application/json");
    expect(c.body).toMatchObject({
      bin: "450799",
      token: "00000000-0000-4000-8000-000000000001",
      amount: 123456,
      currency: "ARS",
      installments: 3,
      payment_type: "single",
      sub_payments: [],
      payment_method_id: 1,
      site_transaction_id: REF,
    });
    expect(Number.isInteger(c.body.amount)).toBe(true);
    expect(c.body.description).toHaveLength(255);
  });

  it("tolera una base con barra final o con /api/v2 ya puesto", async () => {
    fetchMock.mockImplementation(async () => json(201, aprobado));
    vi.stubEnv("PAYWAY_BASE_URL", `${BASE}/`);
    await payway.crearPago(datos());
    vi.stubEnv("PAYWAY_BASE_URL", `${BASE}/api/v2`);
    await payway.crearPago(datos());
    expect(llamadas().map((c) => c.url)).toEqual([`${BASE}/api/v2/payments`, `${BASE}/api/v2/payments`]);
  });

  it("el site_transaction_id es estable por intento y distinto entre intentos (idempotencia)", async () => {
    fetchMock.mockImplementation(async () => json(201, aprobado));
    await payway.crearPago(datos());
    await payway.crearPago(datos());
    await payway.crearPago(datos({ intentoId: "223e4567-e89b-42d3-a456-426614174000" }));
    const ids = llamadas().map((c) => c.body.site_transaction_id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(ids[0].length).toBeLessThanOrEqual(40);
  });

  it("nunca manda el número de tarjeta, el código de seguridad ni la key en el body", async () => {
    fetchMock.mockImplementation(async () => json(201, aprobado));
    await payway.crearPago(datos());
    const texto = JSON.stringify(llamadas()[0].body);
    expect(texto).not.toContain(KEY_PRIVADA);
    expect(texto).not.toMatch(/card_number|security_code/);
  });
});

describe("crearPago — validaciones locales (no llegan a Payway)", () => {
  it.each([
    ["Mercado Pago como medio", { medio: "cuenta_mp" as const }],
    ["sin token", { token: undefined }],
    ["bin inválido", { bin: "4507" }],
    ["sin bin", { bin: undefined }],
    ["sin intento", { intentoId: undefined }],
    ["payment_method_id que no es de tarjeta (offline)", { metodoPagoId: "25" }],
    ["payment_method_id no numérico", { metodoPagoId: "visa" }],
    ["sin payment_method_id", { metodoPagoId: undefined }],
    ["débito en cuotas", { metodoPagoId: "31", cuotas: 3 }],
    ["cuotas fuera de rango", { cuotas: 100 }],
    ["monto inválido", { monto: 0 }],
  ])("%s -> ErrorProveedor 400 sin llamar a la red", async (_n, extra) => {
    await expect(payway.crearPago(datos(extra))).rejects.toMatchObject({ name: "ErrorProveedor", status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("débito en 1 cuota sí se cobra, con el id propio del débito", async () => {
    fetchMock.mockImplementation(async () => json(201, aprobado));
    await payway.crearPago(datos({ metodoPagoId: "31", cuotas: 1 }));
    expect(llamadas()[0].body.payment_method_id).toBe(31);
  });
});

describe("crearPago — respuestas", () => {
  it("201 aprobado: pagado, con la referencia del intento", async () => {
    fetchMock.mockImplementation(async () => json(201, aprobado));
    const e = await payway.crearPago(datos());
    expect(e).toMatchObject({ estado: "pagado", referencia: REF, cuotasPagadas: 1, totalPagado: 10 });
  });

  it("402 es un rechazo con el cuerpo del pago: se parsea, no es un error de red", async () => {
    fetchMock.mockImplementation(async () => json(402, rechazado51));
    const e = await payway.crearPago(datos());
    expect(e).toMatchObject({ estado: "fallido", motivo: "fondos", referencia: REF });
    // Un rechazo no dispara ninguna consulta ni reintento.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("402 sin status en el cuerpo igual es un rechazo", async () => {
    fetchMock.mockImplementation(async () => json(402, { id: 1, status_details: { error: { reason: { id: 51 } } } }));
    const e = await payway.crearPago(datos());
    expect(e).toMatchObject({ estado: "fallido", motivo: "fondos", referencia: REF });
  });

  it("400: ErrorProveedor con status 400 (seguro que no hay pago)", async () => {
    fetchMock.mockImplementation(async () => json(400, error400));
    await expect(payway.crearPago(datos())).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, error401],
    [403, error403],
  ])("%s: ErrorProveedor y log de configuración, sin filtrar la key", async (status, cuerpo) => {
    fetchMock.mockImplementation(async () => json(status, cuerpo));
    await expect(payway.crearPago(datos())).rejects.toMatchObject({ status });
    const logs = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logs).toContain(String(status));
    expect(logs).not.toContain(KEY_PRIVADA);
    expect(logs).not.toContain("00000000-0000-4000-8000-000000000001");
  });

  it("404 (token inexistente o vencido): ErrorProveedor 404", async () => {
    fetchMock.mockImplementation(async () => json(404, error404));
    await expect(payway.crearPago(datos())).rejects.toMatchObject({ status: 404 });
  });
});

describe("crearPago — control de fraude (Cybersource)", () => {
  const antifraude = {
    clienteId: "user_sintetico123",
    email: "comprador@cliente.example",
    nombre: "Ana Gomez",
    telefono: "2235550100",
    entrega: { tipo: "retiro" as const },
    items: [{ sku: "LED-9W", nombre: "Lampara LED", cantidad: 2, total: 20 }],
  };

  it("el proveedor pide los datos del pedido", () => {
    expect(payway.requiereAntifraude).toBe(true);
  });

  it("manda fraud_detection con el monto en centavos y los items del pedido", async () => {
    fetchMock.mockImplementation(async () => json(201, aprobado));
    await payway.crearPago(datos({ monto: 20, antifraude }));
    const fd = llamadas()[0].body.fraud_detection;
    expect(fd).toMatchObject({
      send_to_cs: true,
      channel: "Web",
      purchase_totals: { currency: "ARS", amount: 2000 },
      bill_to: { customer_id: "user_sintetico123", email: "comprador@cliente.example", country: "AR" },
    });
    expect(fd.retail_transaction_data.items).toEqual([
      expect.objectContaining({ sku: "LED-9W", quantity: 2, unit_price: 1000, total_amount: 2000 }),
    ]);
  });

  it("sin datos de antifraude no manda el bloque", async () => {
    fetchMock.mockImplementation(async () => json(201, aprobado));
    await payway.crearPago(datos());
    expect(llamadas()[0].body.fraud_detection).toBeUndefined();
  });

  it("si falta un dato obligatorio corta antes de la red, sin pago (4xx)", async () => {
    const e = await payway.crearPago(datos({ antifraude: { ...antifraude, email: "" } })).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorProveedor);
    expect(e.status).toBeLessThan(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechazo del control de fraude (cybersource_error): fallido con motivo propio", async () => {
    fetchMock.mockResolvedValueOnce(
      json(402, { ...rechazado51, status_details: { error: { type: "cybersource_error", reason: { id: -1 } } } }),
    );
    expect(await payway.crearPago(datos())).toMatchObject({ estado: "fallido", motivo: "control_seguridad" });
  });
});

describe("crearPago — timeout: se consulta antes de cualquier otra cosa, nunca se reintenta el POST", () => {
  it("timeout y la consulta por siteOperationId encuentra el pago aprobado: pagado", async () => {
    fetchMock
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(json(200, listadoUnPago));
    const e = await payway.crearPago(datos());
    expect(e.estado).toBe("pagado");

    const c = llamadas();
    expect(c.filter((x) => x.metodo === "POST")).toHaveLength(1);
    expect(c[1].metodo).toBe("GET");
    expect(c[1].url).toBe(`${BASE}/api/v2/payments?siteOperationId=${REF}`);
  });

  it("5xx: mismo camino que un timeout", async () => {
    fetchMock.mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, listadoUnPago));
    expect((await payway.crearPago(datos())).estado).toBe("pagado");
    expect(llamadas().filter((x) => x.metodo === "POST")).toHaveLength(1);
  });

  it("error de red: mismo camino que un timeout", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(json(200, listadoUnPago));
    expect((await payway.crearPago(datos())).estado).toBe("pagado");
  });

  it("la consulta encuentra el pago rechazado: fallido con motivo", async () => {
    fetchMock
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(json(200, { ...listadoVacio, results: [rechazado51] }));
    expect(await payway.crearPago(datos())).toMatchObject({ estado: "fallido", motivo: "fondos" });
  });

  it("la consulta no encuentra nada (tres veces, con pausa de 3 s): pendiente con la referencia, sin tirar y sin segundo POST", async () => {
    fetchMock
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(json(200, listadoVacio))
      .mockResolvedValueOnce(json(200, listadoVacio))
      .mockResolvedValueOnce(json(200, listadoVacio));
    const e = await payway.crearPago(datos());
    expect(e).toMatchObject({ estado: "pendiente", referencia: REF });
    expect(llamadas().filter((x) => x.metodo === "POST")).toHaveLength(1);
    expect(llamadas().filter((x) => x.metodo === "GET")).toHaveLength(3);
    expect(pausa).toHaveBeenCalledTimes(2);
    expect(pausa).toHaveBeenCalledWith(3_000);
  });

  it("el pago aparece recién en la tercera consulta: se resuelve sin tocar el POST", async () => {
    fetchMock
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(json(200, listadoVacio))
      .mockResolvedValueOnce(json(200, listadoVacio))
      .mockResolvedValueOnce(json(200, listadoUnPago));
    expect((await payway.crearPago(datos())).estado).toBe("pagado");
    expect(llamadas().filter((x) => x.metodo === "POST")).toHaveLength(1);
  });

  it("espera hasta 30 s por el POST y 15 s por las consultas", async () => {
    const espiado = vi.spyOn(AbortSignal, "timeout");
    const real = crearPayway({ fetch: fetchMock as unknown as typeof fetch, pausa });
    fetchMock.mockResolvedValueOnce(json(201, aprobado));
    await real.crearPago(datos());
    expect(espiado).toHaveBeenLastCalledWith(30_000);
    fetchMock.mockResolvedValueOnce(json(200, listadoUnPago));
    await real.consultarPago(REF);
    expect(espiado).toHaveBeenLastCalledWith(15_000);
  });

  it("la consulta también falla: pendiente con la referencia (el cron lo reconcilia)", async () => {
    fetchMock.mockRejectedValue(abortError());
    const e = await payway.crearPago(datos());
    expect(e).toMatchObject({ estado: "pendiente", referencia: REF });
    expect(llamadas().filter((x) => x.metodo === "POST")).toHaveLength(1);
  });
});

describe("consultarPago", () => {
  it("GET /payments?siteOperationId= con la key privada: devuelve el estado real", async () => {
    fetchMock.mockImplementation(async () => json(200, listadoUnPago));
    const e = await payway.consultarPago(REF);
    expect(e).toMatchObject({ estado: "pagado", referencia: aprobado.site_transaction_id });
    const [c] = llamadas();
    expect(c.metodo).toBe("GET");
    expect(c.url).toBe(`${BASE}/api/v2/payments?siteOperationId=${REF}`);
    expect(c.headers.apikey).toBe(KEY_PRIVADA);
  });

  it("detecta una anulación posterior (reversión)", async () => {
    fetchMock.mockImplementation(async () => json(200, { ...listadoVacio, results: [pagoAnulado] }));
    expect(await payway.consultarPago(REF)).toMatchObject({ estado: "fallido", reversion: true });
  });

  it("listado vacío: pendiente marcado como no encontrado (no se da por fallido)", async () => {
    fetchMock.mockImplementation(async () => json(200, listadoVacio));
    expect(await payway.consultarPago(REF)).toMatchObject({
      estado: "pendiente",
      referencia: REF,
      noEncontrado: true,
    });
  });

  it("404: también no encontrado", async () => {
    fetchMock.mockImplementation(async () => json(404, error404));
    expect(await payway.consultarPago(REF)).toMatchObject({ estado: "pendiente", noEncontrado: true });
  });

  it("de varios resultados toma el que coincide con la referencia", async () => {
    const otro = { ...rechazado51, site_transaction_id: "otraoperacion" };
    fetchMock.mockImplementation(async () => json(200, { ...listadoVacio, results: [otro, aprobado] }));
    expect((await payway.consultarPago(aprobado.site_transaction_id)).estado).toBe("pagado");
  });

  it.each([[401], [403], [400], [500]])("%s: ErrorProveedor (el que llama decide)", async (status) => {
    fetchMock.mockImplementation(async () => json(status, error401));
    await expect(payway.consultarPago(REF)).rejects.toBeInstanceOf(ErrorProveedor);
  });

  it("timeout: ErrorProveedor retriable (>= 500), no un resultado inventado", async () => {
    fetchMock.mockRejectedValue(abortError());
    await expect(payway.consultarPago(REF)).rejects.toMatchObject({ status: 504 });
  });

  it("escapa la referencia en la URL", async () => {
    fetchMock.mockImplementation(async () => json(200, listadoVacio));
    await payway.consultarPago("a b&c=d");
    expect(llamadas()[0].url).toBe(`${BASE}/api/v2/payments?siteOperationId=a%20b%26c%3Dd`);
  });
});

describe("cancelarPago", () => {
  it("sólo consulta: devuelve el estado real y NUNCA reembolsa", async () => {
    fetchMock.mockImplementation(async () => json(200, listadoUnPago));
    const e = await payway.cancelarPago(REF);
    expect(e.estado).toBe("pagado");
    const c = llamadas();
    expect(c).toHaveLength(1);
    expect(c[0].metodo).toBe("GET");
    expect(c.some((x) => /refunds/.test(x.url))).toBe(false);
  });

  it("rechazado: fallido", async () => {
    fetchMock.mockImplementation(async () => json(200, { ...listadoVacio, results: [rechazado51] }));
    expect((await payway.cancelarPago(REF)).estado).toBe("fallido");
  });
});
