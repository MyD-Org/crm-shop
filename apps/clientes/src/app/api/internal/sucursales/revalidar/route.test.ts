import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...a: unknown[]) => revalidateTag(...a),
}));

import { POST } from "./route";

const req = (auth?: string) =>
  new Request("http://localhost/api/internal/sucursales/revalidar", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

/** Aviso del CRM al guardar sucursales o zonas: exige 2xx + JSON `{ ok: true }`. */
describe("POST /api/internal/sucursales/revalidar", () => {
  beforeEach(() => {
    revalidateTag.mockReset();
    process.env.SHOP_CRM_SECRET = "int-789";
  });

  it("401 sin secreto válido y no invalida nada", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer nope"))).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("vence los tags sucursales y catalogo con expire 0 y responde { ok: true } en JSON", async () => {
    const r = await POST(req("Bearer int-789"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(await r.json()).toEqual({ ok: true });
    expect(revalidateTag).toHaveBeenCalledWith("sucursales", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("catalogo", { expire: 0 });
  });
});
