import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * API de comprobantes de Mi cuenta (CMP-1/2/4/5): 503 sin R2, 400 con
 * `fields`, 429 al 11º de la hora sin crear fila, tope diario de la base, el
 * cliente SIEMPRE de la identidad y `private, no-store`. Repo y R2 falsos.
 */

const identidad = vi.fn();
/** Cuenta corriente por defecto; `mockResolvedValueOnce(false)` = contado o sin fila en el espejo. */
const acceso = vi.fn(async () => true);
const r2 = { presignPut: vi.fn() };
const getR2 = vi.fn<() => typeof r2 | null>();
const crearSubiendo = vi.fn();
const contarRecientes = vi.fn();
const listarDelCliente = vi.fn();
const contactoPorId = vi.fn();

vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/acceso-facturacion", () => ({ accesoFacturacion: () => acceso() }));
vi.mock("@/lib/r2", () => ({ getComprobantesR2: () => getR2() }));
vi.mock("@/lib/tenant", () => ({ shopTenantId: () => "tenant-a" }));
vi.mock("@/lib/contactos-espejo", () => ({ contactoPorId: (...a: unknown[]) => contactoPorId(...a) }));
vi.mock("@/lib/comprobantes/repo", () => ({
  crearSubiendo: (...a: unknown[]) => crearSubiendo(...a),
  contarRecientes: (...a: unknown[]) => contarRecientes(...a),
  listarDelCliente: (...a: unknown[]) => listarDelCliente(...a),
}));

import { arYmd } from "@/lib/comprobantes/validacion";
import { GET, POST } from "./route";

const ID = "11111111-2222-4333-8444-555555555555";
// "Hoy" del negocio (Argentina), no el de UTC: desde las 21:00 AR el día UTC ya es mañana.
const hoy = () => arYmd(new Date());

function body(overrides: Record<string, unknown> = {}) {
  return {
    amount: "150000",
    paidOn: "2025-12-01",
    method: "transferencia",
    file: { name: "comprobante.pdf", size: 1_000_000, contentType: "application/pdf" },
    ...overrides,
  };
}

const post = (b: unknown) =>
  POST(new Request("http://localhost/api/mi-cuenta/comprobantes", { method: "POST", body: JSON.stringify(b) }));

let codigo = 100;
function vinculado(extra: Record<string, unknown> = {}) {
  // Un código distinto por test: el límite por hora vive en memoria del proceso.
  codigo++;
  identidad.mockResolvedValue({
    clerkUserId: "user_1",
    cliente: {
      codigocliente: String(codigo),
      razonsocial: "Cliente Demo SRL",
      cuit: "30123456780",
      email: "cliente@empresa.cliente.example",
      origen: "vinculacion",
      ...extra,
    },
  });
  return String(codigo);
}

beforeEach(() => {
  identidad.mockReset();
  getR2.mockReset();
  r2.presignPut.mockReset();
  crearSubiendo.mockReset();
  contarRecientes.mockReset();
  listarDelCliente.mockReset();
  contactoPorId.mockReset();
  getR2.mockReturnValue(r2);
  contarRecientes.mockResolvedValue(0);
  crearSubiendo.mockResolvedValue({ id: ID });
  r2.presignPut.mockResolvedValue({
    url: "https://acc.r2.cloudflarestorage.com/bucket/tmp/receipts/tenant-a/x?X-Amz-Signature=s",
    headers: { "content-type": "application/pdf" },
    expiresAt: new Date("2026-09-12T13:10:00.000Z"),
  });
});

describe("POST /api/mi-cuenta/comprobantes (init)", () => {
  it("anónimo: 401; sin vínculo o de contado: 404; nada se crea", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    expect((await post(body())).status).toBe(401);
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
    expect((await post(body())).status).toBe(404);
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
    acceso.mockResolvedValueOnce(false);
    expect((await post(body())).status).toBe(404);
    expect(crearSubiendo).not.toHaveBeenCalled();
  });

  it("CMP-5 sin R2: 503 en usted", async () => {
    vinculado();
    getR2.mockReturnValue(null);
    const res = await post(body());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "El servicio de comprobantes no está disponible. Inténtelo de nuevo más tarde.",
    });
    expect(crearSubiendo).not.toHaveBeenCalled();
  });

  it("CMP-1 validación: 400 con fields por campo y nada se escribe", async () => {
    vinculado();
    const res = await post(body({ amount: "0", paidOn: "2999-01-01", method: "otro", methodOther: "" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const json = await res.json();
    expect(json.error).toBe("Revise los datos del formulario.");
    expect(Object.keys(json.fields).sort()).toEqual(["amount", "methodOther", "paidOn"]);
    expect(crearSubiendo).not.toHaveBeenCalled();
  });

  it("happy path: fila con los datos de la IDENTIDAD (ignora los del body) y URL PUT firmada", async () => {
    const cod = vinculado();
    const res = await post(body({ codigocliente: "999", razonsocial: "Otro", cuit: "1", paidOn: hoy() }));
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const json = await res.json();
    expect(json.id).toBe(ID);
    expect(json.upload).toMatchObject({ method: "PUT", headers: { "content-type": "application/pdf" } });
    expect(crearSubiendo).toHaveBeenCalledTimes(1);
    const [tenant, alta] = crearSubiendo.mock.calls[0] as [string, Record<string, unknown>];
    expect(tenant).toBe("tenant-a");
    expect(alta).toMatchObject({
      codigocliente: cod,
      razonsocial: "Cliente Demo SRL",
      cuit: "30123456780",
      clientEmail: "cliente@empresa.cliente.example",
      amount: "150000",
      declaredContentType: "application/pdf",
      declaredSize: 1_000_000,
    });
    expect(r2.presignPut).toHaveBeenCalledWith(`tmp/receipts/tenant-a/${ID}`, {
      contentType: "application/pdf",
      contentLength: 1_000_000,
      ttlSeconds: 600,
    });
  });

  describe("reloj fijo a las 23:30 de Argentina (02:30 UTC del día siguiente)", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-25T02:30:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("el pago de hoy en Argentina se acepta aunque en UTC ya sea mañana", async () => {
      vinculado();
      expect(hoy()).toBe("2026-09-24");
      const res = await post(body({ paidOn: "2026-09-24" }));
      expect(res.status).toBe(201);
      expect(crearSubiendo.mock.calls[0]?.[1]).toMatchObject({ paidOn: "2026-09-24" });
    });

    it("el día UTC (mañana en Argentina) se rechaza como fecha futura", async () => {
      vinculado();
      const res = await post(body({ paidOn: "2026-09-25" }));
      expect(res.status).toBe(400);
      expect(Object.keys((await res.json()).fields)).toEqual(["paidOn"]);
      expect(crearSubiendo).not.toHaveBeenCalled();
    });
  });

  it("sesión heredada sin razón social: se completa con el espejo", async () => {
    vinculado({ razonsocial: undefined, cuit: undefined, email: undefined, origen: "cookie_crm" });
    contactoPorId.mockResolvedValue({
      nombre: "Espejo SA",
      identificacion: "30700000001",
      email: "e@espejo.cliente.example",
    });
    await post(body());
    expect(crearSubiendo.mock.calls[0]?.[1]).toMatchObject({
      razonsocial: "Espejo SA",
      cuit: "30700000001",
      clientEmail: "e@espejo.cliente.example",
    });
  });

  it("CMP-2: el 11º de la hora ⇒ 429 con el mensaje horario y sin fila", async () => {
    vinculado();
    for (let i = 0; i < 10; i++) expect((await post(body())).status).toBe(201);
    const res = await post(body());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(
      "Informó demasiados comprobantes en la última hora. Inténtelo de nuevo más tarde.",
    );
    expect(crearSubiendo).toHaveBeenCalledTimes(10);
  });

  it("CMP-2: 20 en el día (contados en la base) ⇒ 429 con el mensaje diario", async () => {
    vinculado();
    contarRecientes.mockResolvedValue(20);
    const res = await post(body());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("Llegó al límite de 20 comprobantes por día. Inténtelo de nuevo mañana.");
    expect(crearSubiendo).not.toHaveBeenCalled();
  });

  it("tipo no admitido ⇒ 415 en usted", async () => {
    vinculado();
    const res = await post(body({ file: { name: "a.svg", size: 10, contentType: "image/svg+xml" } }));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/^El tipo de archivo no es válido\. Suba un PDF o una imagen/);
  });

  it("falla de la base ⇒ 500 en usted, sin la URL firmada ni datos en el log", async () => {
    vinculado();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    crearSubiendo.mockRejectedValue(new Error("30123456780 connection refused"));
    const res = await post(body());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(
      "No pudimos preparar la subida del comprobante. Inténtelo de nuevo en unos minutos.",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("30123456780");
    log.mockRestore();
  });
});

describe("GET /api/mi-cuenta/comprobantes (Mis comprobantes)", () => {
  it("lista los propios con start saneado; el cliente de la identidad", async () => {
    const cod = vinculado();
    listarDelCliente.mockResolvedValue({ comprobantes: [], total: 0 });
    const res = await GET(new Request(`http://localhost/api/mi-cuenta/comprobantes?start=10&codigocliente=999`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(listarDelCliente).toHaveBeenCalledWith("tenant-a", cod, 10);
    await GET(new Request(`http://localhost/api/mi-cuenta/comprobantes?start=-3`));
    expect(listarDelCliente).toHaveBeenLastCalledWith("tenant-a", cod, 0);
  });

  it("sin R2 ⇒ 503; anónimo ⇒ 401", async () => {
    vinculado();
    getR2.mockReturnValue(null);
    expect((await GET(new Request("http://localhost/api/mi-cuenta/comprobantes"))).status).toBe(503);
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    expect((await GET(new Request("http://localhost/api/mi-cuenta/comprobantes"))).status).toBe(401);
  });
});
