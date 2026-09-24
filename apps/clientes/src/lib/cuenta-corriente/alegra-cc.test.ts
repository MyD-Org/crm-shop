import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("../alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../alegra")>()),
  apiFetch: (path: string, params: Record<string, unknown>) => apiFetch(path, params),
}));

import {
  computeBalance,
  esLimiteAlegra,
  fetchWindow,
  getDocumentPdf,
  hoyArgentina,
  listInvoicesPageByContact,
  listOpenInvoicesByContact,
  listPaymentsPageByContact,
  mapRawInvoice,
  mapRawPayment,
  type AlegraInvoiceCC,
} from "./alegra-cc";

beforeEach(() => {
  apiFetch.mockReset();
});

const fila = (id: number) => ({ id, date: "2026-09-01", total: 100, balance: 0, status: "closed", client: { id: 42 } });

describe("fetchWindow", () => {
  it("con metadata: total de metadata y filas de data", async () => {
    apiFetch.mockResolvedValue({ metadata: { total: 45 }, data: [fila(1), fila(2)] });
    const r = await fetchWindow("/invoices", mapRawInvoice, { client_id: "42" }, { start: 0, limit: 30 });
    expect(r.total).toBe(45);
    expect(r.items.map((i) => i.alegraId)).toEqual(["1", "2"]);
    expect(apiFetch).toHaveBeenCalledWith("/invoices", expect.objectContaining({ metadata: "true", start: 0, limit: 30 }));
  });

  it("array pelado: total 0 y filas igual", async () => {
    apiFetch.mockResolvedValue([fila(1)]);
    const r = await fetchWindow("/invoices", mapRawInvoice, {}, { start: 0, limit: 30 });
    expect(r).toMatchObject({ total: 0 });
    expect(r.items).toHaveLength(1);
  });

  it("ventana mayor a 30: pedidos de a 30 y sólo el primero pide metadata", async () => {
    apiFetch.mockResolvedValue([]);
    await fetchWindow("/invoices", mapRawInvoice, {}, { start: 30, limit: 45 });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[0][1]).toMatchObject({ start: 30, limit: 30, metadata: "true" });
    expect(apiFetch.mock.calls[1][1]).toMatchObject({ start: 60, limit: 15 });
    expect(apiFetch.mock.calls[1][1]).not.toHaveProperty("metadata");
  });
});

describe("filtros → parámetros de Alegra", () => {
  it("facturas: cliente, orden, estado y fechas de emisión", async () => {
    apiFetch.mockResolvedValue({ metadata: { total: 0 }, data: [] });
    await listInvoicesPageByContact("42", {
      start: 0,
      limit: 30,
      filters: { status: "open", dateFrom: "2026-01-01", dateTo: "2026-06-30" },
    });
    expect(apiFetch).toHaveBeenCalledWith(
      "/invoices",
      expect.objectContaining({
        client_id: "42",
        order_field: "date",
        order_direction: "DESC",
        status: "open",
        date_afterOrNow: "2026-01-01",
        date_beforeOrNow: "2026-06-30",
      }),
    );
  });

  it("pagos: sólo cobros (type=in) y páginas del tamaño pedido", async () => {
    apiFetch.mockResolvedValue({ metadata: { total: 0 }, data: [] });
    await listPaymentsPageByContact("42", { start: 10, limit: 10 });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/payments", expect.objectContaining({ client_id: "42", type: "in", start: 10, limit: 10 }));
  });
});

describe("listOpenInvoicesByContact", () => {
  it("pagina de a 30 hasta una página incompleta, sólo abiertas", async () => {
    apiFetch
      .mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => fila(i)))
      .mockResolvedValueOnce([fila(99)]);
    const abiertas = await listOpenInvoicesByContact("42");
    expect(abiertas).toHaveLength(31);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[1][1]).toMatchObject({ client_id: "42", status: "open", start: 30 });
  });
});

describe("mapRawPayment", () => {
  it("medio como objeto y facturas imputadas", () => {
    const p = mapRawPayment({
      id: 5,
      number: "RC-1",
      date: "2026-09-10",
      amount: 300,
      paymentMethod: { name: "Transferencia" },
      invoices: [
        { id: 1, numberTemplate: { fullNumber: "F1" }, amount: 200 },
        { id: 2, number: "F2", amount: 100 },
      ],
    });
    expect(p.method).toBe("Transferencia");
    expect(p.invoices).toEqual([
      { invoiceAlegraId: "1", invoiceNumber: "F1", amount: 200 },
      { invoiceAlegraId: "2", invoiceNumber: "F2", amount: 100 },
    ]);
  });
});

describe("computeBalance (SAL-1)", () => {
  const inv = (balance: number, dueDate: string, status = "open"): AlegraInvoiceCC => ({
    alegraId: "x",
    number: null,
    date: "2026-08-01",
    dueDate,
    total: 1000,
    balance,
    status,
    clientAlegraId: "42",
  });

  it("mezcla: deuda 150, vencido 100, a vencer 50; saldo 0 no cuenta", () => {
    const saldo = computeBalance(
      [inv(100, "2026-09-01"), inv(50, "2026-10-01"), inv(0, "2026-08-01")],
      "2026-09-23",
    );
    expect(saldo).toEqual({ total: 150, overdue: 100, toFallDue: 50 });
  });

  it("vence hoy: todavía no está vencida", () => {
    expect(computeBalance([inv(10, "2026-09-23")], "2026-09-23")).toEqual({ total: 10, overdue: 0, toFallDue: 10 });
  });

  it("anuladas, cerradas y borradores no son deuda", () => {
    expect(
      computeBalance([inv(10, "2026-01-01", "void"), inv(10, "2026-01-01", "closed"), inv(10, "2026-01-01", "draft")], "2026-09-23"),
    ).toEqual({ total: 0, overdue: 0, toFallDue: 0 });
  });

  it("hoy en Argentina: a las 01:00 UTC todavía es el día anterior", () => {
    expect(hoyArgentina(new Date("2026-09-24T01:00:00Z"))).toBe("2026-09-23");
  });
});

describe("getDocumentPdf", () => {
  it("devuelve dueño, URL y número", async () => {
    apiFetch.mockResolvedValue({ id: 9, client: { id: 42 }, pdf: "https://pdf.plataforma.example/x", numberTemplate: { fullNumber: "A-1" } });
    expect(await getDocumentPdf("factura", "9")).toEqual({
      clientAlegraId: "42",
      pdfUrl: "https://pdf.plataforma.example/x",
      number: "A-1",
    });
    expect(apiFetch).toHaveBeenCalledWith("/invoices/9", { fields: "pdf" });
  });

  it("id inválido: null sin llamar a Alegra", async () => {
    expect(await getDocumentPdf("factura", "../x")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("404 de Alegra: null", async () => {
    apiFetch.mockImplementation(async () => {
      throw new Error("Alegra 404 en /invoices/9: no existe");
    });
    expect(await getDocumentPdf("pago", "9")).toBeNull();
  });

  it("otro error: se propaga", async () => {
    apiFetch.mockImplementation(async () => {
      throw new Error("Alegra 500 en /estimates/9: x");
    });
    await expect(getDocumentPdf("presupuesto", "9")).rejects.toThrow("Alegra 500");
  });
});

describe("esLimiteAlegra", () => {
  it("429 y 400 disfrazado", () => {
    expect(esLimiteAlegra(new Error("Alegra 429 en /invoices: x"))).toBe(true);
    expect(esLimiteAlegra(new Error('Alegra 400 en /invoices: {"code":429,"message":"x"}'))).toBe(true);
    expect(esLimiteAlegra(new Error("Alegra 400 en /invoices: fecha"))).toBe(false);
    expect(esLimiteAlegra("x")).toBe(false);
  });
});
