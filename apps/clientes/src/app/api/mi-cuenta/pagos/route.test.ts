import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * API de pagos de Mi cuenta: el cliente sale de la identidad (ACC-3), `start`
 * inválido ⇒ 0, sin filtros de fecha (Alegra los ignora), 429 ⇒ 503 y siempre
 * `private, no-store` (ACC-5).
 */

const identidad = vi.fn();
/** Cuenta corriente por defecto; `mockResolvedValueOnce(false)` = contado o sin fila en el espejo. */
const acceso = vi.fn(async () => true);
const getPagosPage = vi.fn();
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/acceso-facturacion", () => ({ accesoFacturacion: () => acceso() }));
vi.mock("@/lib/cuenta-corriente/erp-cc", () => ({
  PAGOS_PAGE_SIZE: 10,
  getPagosPage: (...a: unknown[]) => getPagosPage(...a),
}));
vi.mock("@/lib/cuenta-corriente/alegra-cc", () => ({
  esLimiteAlegra: (e: unknown) => e instanceof Error && /^Alegra 429 /.test(e.message),
}));

import { GET } from "./route";

const pedir = (q = "") => GET(new Request(`http://localhost/api/mi-cuenta/pagos${q}`));

beforeEach(() => {
  identidad.mockReset();
  getPagosPage.mockReset();
  identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
  getPagosPage.mockResolvedValue({ pagos: [], total: 0 });
});

describe("GET /api/mi-cuenta/pagos", () => {
  it("anónimo: 401 sin llamar a Alegra", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    const res = await pedir();
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getPagosPage).not.toHaveBeenCalled();
  });

  it("sin vínculo o de contado: 404 sin llamar a Alegra", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
    const res = await pedir();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Esta sección no está disponible para su cuenta." });
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
    acceso.mockResolvedValueOnce(false);
    expect((await pedir()).status).toBe(404);
    expect(getPagosPage).not.toHaveBeenCalled();
  });

  it("parámetro inyectado: siempre el contacto de la identidad, de a 10, fechas ignoradas", async () => {
    getPagosPage.mockResolvedValue({ pagos: [{ id: "RC-1" }], total: 12 });
    const res = await pedir("?client_id=99&start=10&desde=2026-01-01");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ pagos: [{ id: "RC-1" }], total: 12 });
    expect(getPagosPage).toHaveBeenCalledWith("42", 10, 10);
  });

  it.each(["-5", "abc", "1.5"])("start=%s ⇒ 0", async (start) => {
    await pedir(`?start=${start}`);
    expect(getPagosPage).toHaveBeenCalledWith("42", 0, 10);
  });

  it("429 de Alegra ⇒ 503; otra falla ⇒ 502 en usted; nunca el cuerpo de Alegra", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    getPagosPage.mockRejectedValue(new Error('Alegra 429 {"secreto":"x"}'));
    let res = await pedir();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "El sistema de facturación está ocupado. Inténtelo de nuevo en unos minutos.",
    });
    getPagosPage.mockRejectedValue(new Error('Alegra 500 {"secreto":"x"}'));
    res = await pedir();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "No pudimos obtener sus pagos. Inténtelo de nuevo en unos minutos." });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secreto");
    log.mockRestore();
  });
});
