import { beforeEach, describe, expect, it, vi } from "vitest";

const bajaPorToken = vi.fn();
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/tenant", () => ({ shopTenantId: () => "tenant-a" }));
vi.mock("@/lib/aviso-reingreso-repo", () => ({ bajaPorToken: (...a: unknown[]) => bajaPorToken(...a) }));

import { POST } from "./route";

const post = (qs: string) =>
  POST(new Request(`https://tienda.example/api/aviso-reingreso/baja${qs}`, { method: "POST", body: "List-Unsubscribe=One-Click" }));

describe("POST /api/aviso-reingreso/baja (one-click)", () => {
  beforeEach(() => {
    bajaPorToken.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("token válido: 200 y la baja se pide con el tenant y el token", async () => {
    bajaPorToken.mockResolvedValue(true);
    const res = await post("?token=abc_123");
    expect(res.status).toBe(200);
    expect(bajaPorToken).toHaveBeenCalledWith({}, "tenant-a", "abc_123");
  });

  it("token inexistente: 404 neutro", async () => {
    bajaPorToken.mockResolvedValue(false);
    const res = await post("?token=nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Enlace no válido" });
  });

  it("sin token: 404, no revienta", async () => {
    bajaPorToken.mockResolvedValue(false);
    expect((await post("")).status).toBe(404);
  });

  it("si la base falla: 500 sin detalle", async () => {
    bajaPorToken.mockRejectedValue(new Error("detalle interno"));
    const res = await post("?token=abc");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("detalle interno");
  });
});
