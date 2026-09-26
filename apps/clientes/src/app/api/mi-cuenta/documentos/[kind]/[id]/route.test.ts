import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PDF proxeado de Mi cuenta (DOC-1, DOC-2): validación antes de llamar a
 * Alegra, pertenencia (ajeno = inexistente), bytes sin la URL firmada, descarga
 * con `?download=1` y `private, no-store`.
 */

const identidad = vi.fn();
/** Cuenta corriente por defecto; `mockResolvedValueOnce(false)` = contado o sin fila en el espejo. */
const acceso = vi.fn(async () => true);
const getDocumentPdf = vi.fn();
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/acceso-facturacion", () => ({ accesoFacturacion: () => acceso() }));
vi.mock("@/lib/cuenta-corriente/alegra-cc", () => ({
  esDocumentKind: (v: unknown) => v === "factura" || v === "pago" || v === "presupuesto",
  esLimiteAlegra: (e: unknown) => e instanceof Error && /^Alegra 429 /.test(e.message),
  getDocumentPdf: (...a: unknown[]) => getDocumentPdf(...a),
}));

import { GET } from "./route";

const URL_FIRMADA = "https://cdn.alegra.example/firmado/abc?token=secreto";
const fetchOriginal = globalThis.fetch;
const fetchPdf = vi.fn();

const pedir = (kind: string, id: string, q = "") =>
  GET(new Request(`http://localhost/api/mi-cuenta/documentos/${kind}/${id}${q}`), {
    params: Promise.resolve({ kind, id }),
  });

beforeEach(() => {
  identidad.mockReset();
  getDocumentPdf.mockReset();
  fetchPdf.mockReset();
  identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
  getDocumentPdf.mockResolvedValue({ clientAlegraId: "42", pdfUrl: URL_FIRMADA, number: "FV-1-000128" });
  fetchPdf.mockResolvedValue(new Response("%PDF-1.4 bytes", { status: 200 }));
  globalThis.fetch = fetchPdf as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

async function esperaError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  const texto = await res.text();
  expect(JSON.parse(texto)).toEqual({ error });
  expect(texto).not.toContain("alegra.example");
}

describe("GET /api/mi-cuenta/documentos/[kind]/[id]", () => {
  it("propio: bytes del PDF inline, sin la URL firmada", async () => {
    const res = await pedir("factura", "1001");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="factura-FV-1-000128.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const cuerpo = await res.text();
    expect(cuerpo).toBe("%PDF-1.4 bytes");
    expect(cuerpo).not.toContain("alegra.example");
    expect(getDocumentPdf).toHaveBeenCalledWith("factura", "1001");
  });

  it("download=1 ⇒ attachment", async () => {
    const res = await pedir("pago", "55", "?download=1");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="pago-FV-1-000128.pdf"');
  });

  it("ajeno: 404 idéntico a inexistente", async () => {
    getDocumentPdf.mockResolvedValue({ clientAlegraId: "7", pdfUrl: URL_FIRMADA, number: "X" });
    await esperaError(await pedir("pago", "55"), 404, "No encontramos el documento.");
    getDocumentPdf.mockResolvedValue(null);
    await esperaError(await pedir("pago", "56"), 404, "No encontramos el documento.");
    // Sin contacto en Alegra: se trata como ajeno.
    getDocumentPdf.mockResolvedValue({ clientAlegraId: null, pdfUrl: URL_FIRMADA, number: "X" });
    await esperaError(await pedir("pago", "57"), 404, "No encontramos el documento.");
    expect(fetchPdf).not.toHaveBeenCalled();
  });

  it.each([
    ["remito", "1"],
    ["factura", "../x"],
    ["factura", "12a"],
    ["factura", "1".repeat(21)],
  ])("%s/%s: 400 sin llamar a Alegra", async (kind, id) => {
    await esperaError(await pedir(kind, id), 400, "Indique el documento.");
    expect(getDocumentPdf).not.toHaveBeenCalled();
    expect(identidad).not.toHaveBeenCalled();
  });

  it("anónimo 401; sin vínculo o de contado 404", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    await esperaError(await pedir("factura", "1"), 401, "Inicie sesión para ver su cuenta corriente.");
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
    await esperaError(await pedir("factura", "1"), 404, "Esta sección no está disponible para su cuenta.");
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
    acceso.mockResolvedValueOnce(false);
    await esperaError(await pedir("factura", "1"), 404, "Esta sección no está disponible para su cuenta.");
    expect(getDocumentPdf).not.toHaveBeenCalled();
  });

  it("sin PDF o falla del CDN o de Alegra: 502 en usted, sin URL en los logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const caido = "No pudimos obtener el documento. Inténtelo de nuevo en unos minutos.";
    getDocumentPdf.mockResolvedValue({ clientAlegraId: "42", pdfUrl: null, number: "X" });
    await esperaError(await pedir("factura", "1"), 502, caido);

    getDocumentPdf.mockResolvedValue({ clientAlegraId: "42", pdfUrl: URL_FIRMADA, number: "X" });
    fetchPdf.mockResolvedValue(new Response("no", { status: 403 }));
    await esperaError(await pedir("factura", "1"), 502, caido);

    getDocumentPdf.mockRejectedValue(new Error("Alegra 500 cuerpo"));
    await esperaError(await pedir("factura", "1"), 502, caido);
    getDocumentPdf.mockRejectedValue(new Error("Alegra 429 cuerpo"));
    await esperaError(await pedir("factura", "1"), 503, caido);

    const logs = JSON.stringify(log.mock.calls);
    expect(logs).not.toContain("alegra.example");
    expect(logs).not.toContain("cuerpo");
    log.mockRestore();
  });
});
