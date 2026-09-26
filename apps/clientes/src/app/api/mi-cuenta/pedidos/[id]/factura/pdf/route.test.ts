import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PDF de la factura vinculada a UN pedido, para el botón "Descargar factura"
 * de Mi cuenta. A diferencia de `/api/mi-cuenta/documentos/[kind]/[id]`, la
 * pertenencia se valida por dueño del PEDIDO (`esDeSuDueno`), no por contacto
 * de Alegra: sirve también para consumidor final sin cuenta corriente. El id
 * de la factura nunca sale del navegador, sale del pedido ya validado.
 */

const identidad = vi.fn();
const getPedido = vi.fn();
const getDocumentPdf = vi.fn();
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/pedidos", () => ({ getPedido: (...a: unknown[]) => getPedido(...a) }));
vi.mock("@/lib/cuenta-corriente/alegra-cc", () => ({
  esLimiteAlegra: (e: unknown) => e instanceof Error && /^Alegra 429 /.test(e.message),
  getDocumentPdf: (...a: unknown[]) => getDocumentPdf(...a),
}));

import { GET } from "./route";

const URL_FIRMADA = "https://cdn.alegra.example/firmado/abc?token=secreto";
const fetchOriginal = globalThis.fetch;
const fetchPdf = vi.fn();

const pedir = (id: string, q = "") =>
  GET(new Request(`http://localhost/api/mi-cuenta/pedidos/${id}/factura/pdf${q}`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  identidad.mockReset();
  getPedido.mockReset();
  getDocumentPdf.mockReset();
  fetchPdf.mockReset();
  identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
  getPedido.mockResolvedValue({ id: "p1", facturaId: "987", facturaNumero: "FV-1-000128" });
  getDocumentPdf.mockResolvedValue({ clientAlegraId: null, pdfUrl: URL_FIRMADA, number: "FV-1-000128" });
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

describe("GET /api/mi-cuenta/pedidos/[id]/factura/pdf", () => {
  it("dueño del pedido, con cuenta corriente o consumidor final: bytes del PDF inline", async () => {
    const res = await pedir("p1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="factura-FV-1-000128.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const cuerpo = await res.text();
    expect(cuerpo).toBe("%PDF-1.4 bytes");
    expect(cuerpo).not.toContain("alegra.example");
    expect(getPedido).toHaveBeenCalledWith("p1", { clerkUserId: "user_1", clienteCodigo: undefined });
    expect(getDocumentPdf).toHaveBeenCalledWith("factura", "987");
  });

  it("download=1 ⇒ attachment", async () => {
    const res = await pedir("p1", "?download=1");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="factura-FV-1-000128.pdf"');
  });

  it("anónimo: 401", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    await esperaError(await pedir("p1"), 401, "Inicie sesión para ver sus pedidos.");
    expect(getPedido).not.toHaveBeenCalled();
  });

  it("pedido ajeno o inexistente: 404 genérico", async () => {
    getPedido.mockResolvedValue(null);
    await esperaError(await pedir("otro"), 404, "No encontramos el pedido.");
    expect(getDocumentPdf).not.toHaveBeenCalled();
  });

  it("pedido propio sin factura vinculada todavía: 404", async () => {
    getPedido.mockResolvedValue({ id: "p1", facturaId: undefined, facturaNumero: undefined });
    await esperaError(await pedir("p1"), 404, "Este pedido todavía no tiene una factura vinculada.");
    expect(getDocumentPdf).not.toHaveBeenCalled();
  });

  it("sin PDF, falla del CDN o de Alegra: 502, límite de Alegra: 503", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const caido = "No pudimos obtener la factura. Inténtelo de nuevo en unos minutos.";

    getDocumentPdf.mockResolvedValue({ clientAlegraId: null, pdfUrl: null, number: "X" });
    await esperaError(await pedir("p1"), 502, caido);

    getDocumentPdf.mockResolvedValue({ clientAlegraId: null, pdfUrl: URL_FIRMADA, number: "X" });
    fetchPdf.mockResolvedValue(new Response("no", { status: 403 }));
    await esperaError(await pedir("p1"), 502, caido);

    getDocumentPdf.mockRejectedValue(new Error("Alegra 500 cuerpo"));
    await esperaError(await pedir("p1"), 502, caido);
    getDocumentPdf.mockRejectedValue(new Error("Alegra 429 cuerpo"));
    await esperaError(await pedir("p1"), 503, caido);

    const logs = JSON.stringify(log.mock.calls);
    expect(logs).not.toContain("alegra.example");
    expect(logs).not.toContain("cuerpo");
    log.mockRestore();
  });
});
