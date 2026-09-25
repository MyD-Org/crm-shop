import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * API de presupuestos de Mi cuenta: el cliente sale de la identidad (ACC-3),
 * filtros resueltos en Alegra (PRE-1), fechas inválidas ⇒ 400, 429 ⇒ 503 y
 * siempre `private, no-store` (ACC-5).
 */

const identidad = vi.fn();
/** Cuenta corriente por defecto; `mockResolvedValueOnce(false)` = contado o sin fila en el espejo. */
const acceso = vi.fn(async () => true);
const getPresupuestosPage = vi.fn();
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/acceso-facturacion", () => ({ accesoFacturacion: () => acceso() }));
vi.mock("@/lib/cuenta-corriente/erp-cc", () => ({
  PRESUPUESTOS_PAGE_SIZE: 30,
  getPresupuestosPage: (...a: unknown[]) => getPresupuestosPage(...a),
}));
vi.mock("@/lib/cuenta-corriente/alegra-cc", () => ({
  esLimiteAlegra: (e: unknown) => e instanceof Error && /^Alegra 429 /.test(e.message),
}));

import { GET } from "./route";

const pedir = (q = "") => GET(new Request(`http://localhost/api/mi-cuenta/presupuestos${q}`));

beforeEach(() => {
  identidad.mockReset();
  getPresupuestosPage.mockReset();
  identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
  getPresupuestosPage.mockResolvedValue({ presupuestos: [], total: 0 });
});

describe("GET /api/mi-cuenta/presupuestos", () => {
  it("anónimo: 401 sin llamar a Alegra", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    const res = await pedir();
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getPresupuestosPage).not.toHaveBeenCalled();
  });

  it("sin vínculo o de contado: 404 sin llamar a Alegra", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
    expect((await pedir()).status).toBe(404);
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
    acceso.mockResolvedValueOnce(false);
    expect((await pedir()).status).toBe(404);
    expect(getPresupuestosPage).not.toHaveBeenCalled();
  });

  it("parámetro inyectado: siempre el contacto de la identidad; Sin aceptar ⇒ unbilled", async () => {
    getPresupuestosPage.mockResolvedValue({ presupuestos: [{ id: "P-1" }], total: 3 });
    const res = await pedir("?client_id=99&start=30&estado=sin_aceptar&desde=2026-01-01&hasta=2026-06-30");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ presupuestos: [{ id: "P-1" }], total: 3 });
    expect(getPresupuestosPage).toHaveBeenCalledWith("42", 30, 30, {
      status: "unbilled",
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
    });
  });

  it("Aceptados ⇒ billed; estado desconocido ⇒ todos; start inválido ⇒ 0", async () => {
    await pedir("?estado=aceptado");
    expect(getPresupuestosPage).toHaveBeenLastCalledWith("42", 0, 30, { status: "billed" });
    await pedir("?estado=vigente&start=-1");
    expect(getPresupuestosPage).toHaveBeenLastCalledWith("42", 0, 30, {});
  });

  it.each(["?desde=2026-06-30&hasta=2026-01-01", "?desde=2026-02-30", "?hasta=ayer"])(
    "%s ⇒ 400 en usted, sin llamar a Alegra",
    async (q) => {
      const res = await pedir(q);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Revise el rango de fechas." });
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(getPresupuestosPage).not.toHaveBeenCalled();
    },
  );

  it("429 de Alegra ⇒ 503; otra falla ⇒ 502 en usted; nunca el cuerpo de Alegra", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    getPresupuestosPage.mockRejectedValue(new Error('Alegra 429 {"secreto":"x"}'));
    let res = await pedir();
    expect(res.status).toBe(503);
    getPresupuestosPage.mockRejectedValue(new Error('Alegra 500 {"secreto":"x"}'));
    res = await pedir();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "No pudimos obtener sus presupuestos. Inténtelo de nuevo en unos minutos.",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secreto");
    log.mockRestore();
  });
});
