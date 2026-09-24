import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * API de avisos de Mi cuenta: el cliente sale de la identidad (ACC-3), ids
 * ajenos ⇒ 200 igual (AVI-3), sin ids ⇒ todos, cuerpo inválido ⇒ 400 y siempre
 * `private, no-store` (ACC-5).
 */

const identidad = vi.fn();
const listarAvisos = vi.fn();
const contarNoLeidos = vi.fn();
const marcarLeidos = vi.fn();
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/cuenta-corriente/avisos", () => ({
  listarAvisos: (...a: unknown[]) => listarAvisos(...a),
  contarNoLeidos: (...a: unknown[]) => contarNoLeidos(...a),
  marcarLeidos: (...a: unknown[]) => marcarLeidos(...a),
}));

import { GET, PATCH } from "./route";

const patch = (body: unknown) =>
  PATCH(
    new Request("http://localhost/api/mi-cuenta/avisos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  identidad.mockReset();
  listarAvisos.mockReset();
  contarNoLeidos.mockReset();
  marcarLeidos.mockReset();
  identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
  listarAvisos.mockResolvedValue([]);
  contarNoLeidos.mockResolvedValue(0);
  marcarLeidos.mockResolvedValue(undefined);
});

describe("GET /api/mi-cuenta/avisos", () => {
  it("anónimo: 401; sin vínculo: 403; sin tocar la base", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    expect((await GET()).status).toBe(401);
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(listarAvisos).not.toHaveBeenCalled();
  });

  it("vinculado: avisos y contador del cliente de la identidad", async () => {
    listarAvisos.mockResolvedValue([{ id: "a" }]);
    contarNoLeidos.mockResolvedValue(1);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ avisos: [{ id: "a" }], noLeidos: 1 });
    expect(listarAvisos).toHaveBeenCalledWith("42");
    expect(contarNoLeidos).toHaveBeenCalledWith("42");
  });

  it("base caída: 502 en usted, sin detalles en el log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    listarAvisos.mockRejectedValue(new Error("permission denied for 42 secreto"));
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "No pudimos obtener sus avisos. Inténtelo de nuevo en unos minutos." });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secreto");
    log.mockRestore();
  });
});

describe("PATCH /api/mi-cuenta/avisos", () => {
  it("anónimo: 401 sin marcar nada", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    expect((await patch({ ids: ["x"] })).status).toBe(401);
    expect(marcarLeidos).not.toHaveBeenCalled();
  });

  it("id ajeno (AVI-3): 200 y el marcado siempre filtra por el cliente de la identidad", async () => {
    contarNoLeidos.mockResolvedValue(2);
    const res = await patch({ ids: ["id-de-otro-cliente"], codigocliente: "99" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, noLeidos: 2 });
    expect(marcarLeidos).toHaveBeenCalledWith("42", ["id-de-otro-cliente"]);
  });

  it("sin ids (o cuerpo vacío): todos", async () => {
    await patch({});
    expect(marcarLeidos).toHaveBeenLastCalledWith("42", undefined);
    await patch("");
    expect(marcarLeidos).toHaveBeenLastCalledWith("42", undefined);
  });

  it("ids con forma inválida: 400 en usted", async () => {
    const res = await patch({ ids: "todos" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Indique los avisos a marcar como leídos." });
    expect((await patch({ ids: [1, 2] })).status).toBe(400);
    expect(marcarLeidos).not.toHaveBeenCalled();
  });

  it("base caída: 502 en usted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    marcarLeidos.mockRejectedValue(new Error("x"));
    const res = await patch({ ids: [] });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "No pudimos marcar sus avisos como leídos. Inténtelo de nuevo en unos minutos.",
    });
  });
});
