import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Factura } from "./tipos";

const getDocumentPdf = vi.fn();
vi.mock("./alegra-cc", () => ({ getDocumentPdf: (...a: unknown[]) => getDocumentPdf(...a) }));

import { resolverDeepLink } from "./deep-link";

const factura = (id: string, alegraId: string): Factura => ({
  id,
  alegraId,
  tipo: "Factura",
  emision: "01/09/2026",
  vencimiento: "",
  importe: 100,
  estado: "pendiente",
});

beforeEach(() => {
  getDocumentPdf.mockReset();
});

describe("resolverDeepLink (FAC-5)", () => {
  it("sin parámetros: nada", async () => {
    expect(await resolverDeepLink("42", {}, [])).toBeNull();
    expect(getDocumentPdf).not.toHaveBeenCalled();
  });

  it("link propio con id de Alegra: abre el visor aunque no esté en la página cargada", async () => {
    getDocumentPdf.mockResolvedValue({ clientAlegraId: "42", pdfUrl: "x", number: "A-0001-00000123" });
    expect(await resolverDeepLink("42", { factura: "A-0001-00000123", alegra: "987" }, [])).toEqual({
      abrir: { kind: "factura", alegraId: "987", titulo: "Factura A-0001-00000123" },
    });
    expect(getDocumentPdf).toHaveBeenCalledWith("factura", "987");
  });

  it("link ajeno o inexistente: 'no encontrada', sin visor", async () => {
    getDocumentPdf.mockResolvedValue({ clientAlegraId: "7", pdfUrl: "x", number: "N" });
    expect(await resolverDeepLink("42", { factura: "N", alegra: "987" }, [])).toEqual({ noEncontrada: true });
    getDocumentPdf.mockResolvedValue(null);
    expect(await resolverDeepLink("42", { alegra: "987" }, [])).toEqual({ noEncontrada: true });
  });

  it("id de Alegra inválido: no llama a Alegra", async () => {
    expect(await resolverDeepLink("42", { alegra: "../x" }, [])).toEqual({ noEncontrada: true });
    expect(getDocumentPdf).not.toHaveBeenCalled();
  });

  it("Alegra caída: se abre igual (la ruta del PDF vuelve a validar)", async () => {
    getDocumentPdf.mockRejectedValue(new Error("Alegra 503 x"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolverDeepLink("42", { factura: "N", alegra: "987" }, [])).toEqual({
      abrir: { kind: "factura", alegraId: "987", titulo: "Factura N" },
    });
  });

  it("aviso viejo sólo con número: se busca entre las cargadas", async () => {
    const cargadas = [factura("FV-1", "11"), factura("FV-2", "12")];
    expect(await resolverDeepLink("42", { factura: "FV-2" }, cargadas)).toEqual({
      abrir: { kind: "factura", alegraId: "12", titulo: "Factura FV-2" },
    });
    expect(await resolverDeepLink("42", { factura: "FV-9" }, cargadas)).toEqual({ noEncontrada: true });
  });
});
