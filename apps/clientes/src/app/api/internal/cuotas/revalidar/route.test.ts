import { beforeEach, describe, expect, it, vi } from "vitest";

const syncConfigCRM = vi.fn();
vi.mock("@/lib/cuotas-sync", () => ({ syncConfigCRM: (...a: unknown[]) => syncConfigCRM(...a) }));
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));

import { POST } from "./route";

const req = (auth?: string, body?: unknown) =>
  new Request("http://localhost/api/internal/cuotas/revalidar", {
    method: "POST",
    headers: auth ? { authorization: auth, "content-type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("POST /api/internal/cuotas/revalidar", () => {
  beforeEach(() => {
    syncConfigCRM.mockReset();
    revalidateTag.mockReset();
    process.env.SHOP_CRM_SECRET = "int-456";
  });

  it("401 sin secreto válido y no refresca", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer nope"))).status).toBe(401);
    expect(syncConfigCRM).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("tras guardar la config vence la oferta cacheada (tag cuotas, expire 0)", async () => {
    syncConfigCRM.mockResolvedValue({ ok: true, fetchedAt: "2026-09-16T20:00:00.000Z", payload: {} });
    await POST(req("Bearer int-456"));
    expect(revalidateTag).toHaveBeenCalledWith("cuotas", { expire: 0 });
  });

  it("200 { ok, fetchedAt } tras re-pull del CRM", async () => {
    syncConfigCRM.mockResolvedValue({ ok: true, fetchedAt: "2026-09-16T20:00:00.000Z", payload: {} });
    const r = await POST(req("Bearer int-456"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, fetchedAt: "2026-09-16T20:00:00.000Z" });
    expect(syncConfigCRM).toHaveBeenCalledWith("ping");
  });

  it("ignora el body: una config inyectada no llega a la sync", async () => {
    syncConfigCRM.mockResolvedValue({ ok: true, fetchedAt: "2026-09-16T20:00:00.000Z", payload: {} });
    const body = { version: "v2", tenant: "central-led", proveedores: [{ id: "x" }] };
    const request = req("Bearer int-456", body);
    await POST(request);
    expect(syncConfigCRM).toHaveBeenCalledTimes(1);
    expect(syncConfigCRM.mock.calls[0]).toEqual(["ping"]);
    expect(request.bodyUsed).toBe(false);
  });

  it("CRM caído o inválido → 502 (la caché la conserva la sync)", async () => {
    syncConfigCRM.mockResolvedValue({ ok: false, error: "CRM respondió HTTP 503" });
    const r = await POST(req("Bearer int-456"));
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ ok: false });
  });
});
