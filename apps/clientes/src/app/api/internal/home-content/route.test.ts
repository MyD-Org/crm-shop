import { beforeEach, describe, expect, it, vi } from "vitest";

const { guardarMock, borrarMock } = vi.hoisted(() => ({
  guardarMock: vi.fn(),
  borrarMock: vi.fn(),
}));

vi.mock("@/lib/home-guardar", () => ({
  guardarSeccionHome: guardarMock,
  borrarSeccionHome: borrarMock,
}));

import { PUT } from "./route";

function req(body: unknown, token?: string) {
  return new Request("http://localhost/api/internal/home-content", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/internal/home-content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOP_CRM_SECRET = "secreto-test";
    guardarMock.mockResolvedValue({ updatedAt: new Date("2026-09-18T00:00:00Z") });
    borrarMock.mockResolvedValue(undefined);
  });

  it("401 sin token y con token incorrecto (y no guarda nada)", async () => {
    expect((await PUT(req({ key: "anuncio", payload: { texto: "x" } }))).status).toBe(401);
    expect((await PUT(req({ key: "anuncio", payload: { texto: "x" } }, "malo"))).status).toBe(401);
    expect(guardarMock).not.toHaveBeenCalled();
    expect(borrarMock).not.toHaveBeenCalled();
  });

  it("400 con JSON roto", async () => {
    const r = await PUT(
      new Request("http://localhost/api/internal/home-content", {
        method: "PUT",
        headers: { authorization: "Bearer secreto-test" },
        body: "{roto",
      }),
    );
    expect(r.status).toBe(400);
  });

  it("400 con key desconocida", async () => {
    const r = await PUT(req({ key: "zzz", payload: {} }, "secreto-test"));
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.detalles[0]).toContain("sección desconocida");
  });

  it("400 con payload inválido y detalles", async () => {
    const r = await PUT(req({ key: "hero", payload: { titulo: 42 } }, "secreto-test"));
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.detalles.length).toBeGreaterThan(0);
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it("200 guarda una sección válida", async () => {
    const payload = { texto: "Envío gratis desde $150.000" };
    const r = await PUT(req({ key: "anuncio", payload }, "secreto-test"));
    expect(r.status).toBe(200);
    expect(guardarMock).toHaveBeenCalledWith("anuncio", payload);
  });

  it("navBadge null borra la fila (badge apagado)", async () => {
    const r = await PUT(req({ key: "navBadge", payload: null }, "secreto-test"));
    expect(r.status).toBe(200);
    expect(borrarMock).toHaveBeenCalledWith("navBadge");
  });
});
