import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * API de facturas de Mi cuenta: el cliente sale de la identidad (ACC-3),
 * validación de fechas (FAC-3), `start` inválido ⇒ 0, 429 de Alegra ⇒ 503 y
 * siempre `private, no-store` (ACC-5).
 */

const identidad = vi.fn();
/** Cuenta corriente por defecto; `mockResolvedValueOnce(false)` = contado o sin fila en el espejo. */
const acceso = vi.fn(async () => true);
const getFacturasPage = vi.fn();
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/acceso-facturacion", () => ({ accesoFacturacion: () => acceso() }));
vi.mock("@/lib/cuenta-corriente/erp-cc", () => ({
  FACTURAS_PAGE_SIZE: 30,
  getFacturasPage: (...a: unknown[]) => getFacturasPage(...a),
}));
vi.mock("@/lib/cuenta-corriente/alegra-cc", () => ({
  esLimiteAlegra: (e: unknown) => e instanceof Error && /^Alegra 429 /.test(e.message),
}));

import { GET } from "./route";

const pedir = (q = "") => GET(new Request(`http://localhost/api/mi-cuenta/facturas${q}`));

beforeEach(() => {
  identidad.mockReset();
  getFacturasPage.mockReset();
  identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
  getFacturasPage.mockResolvedValue({ facturas: [], total: 0 });
});

describe("GET /api/mi-cuenta/facturas", () => {
  it("anónimo: 401 sin llamar a Alegra", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    const res = await pedir();
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getFacturasPage).not.toHaveBeenCalled();
  });

  it("sin vínculo o de contado: 404 sin llamar a Alegra", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
    expect((await pedir()).status).toBe(404);
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
    acceso.mockResolvedValueOnce(false);
    expect((await pedir()).status).toBe(404);
    expect(getFacturasPage).not.toHaveBeenCalled();
  });

  it("parámetro inyectado: siempre el contacto de la identidad", async () => {
    getFacturasPage.mockResolvedValue({ facturas: [{ id: "FV-1" }], total: 1 });
    const res = await pedir("?client_id=99&start=30&estado=pagada&desde=2026-01-01");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ facturas: [{ id: "FV-1" }], total: 1 });
    expect(getFacturasPage).toHaveBeenCalledWith("42", 30, 30, { status: "closed", dateFrom: "2026-01-01" });
  });

  it("start inválido ⇒ 0", async () => {
    await pedir("?start=-5");
    expect(getFacturasPage).toHaveBeenCalledWith("42", 0, 30, {});
  });

  it("FAC-3: desde > hasta ⇒ 400 en usted, sin llamar a Alegra", async () => {
    const res = await pedir("?desde=2026-06-30&hasta=2026-01-01");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Revise el rango de fechas." });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getFacturasPage).not.toHaveBeenCalled();
  });

  it("429 de Alegra ⇒ 503; otra falla ⇒ 502; nunca el cuerpo de Alegra", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    getFacturasPage.mockRejectedValue(new Error('Alegra 429 {"secreto":"x"}'));
    let res = await pedir();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "El sistema de facturación está ocupado. Inténtelo de nuevo en unos minutos.",
    });
    getFacturasPage.mockRejectedValue(new Error('Alegra 500 {"secreto":"x"}'));
    res = await pedir();
    expect(res.status).toBe(502);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secreto");
    log.mockRestore();
  });
});
