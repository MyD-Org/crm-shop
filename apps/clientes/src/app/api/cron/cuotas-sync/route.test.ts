import { beforeEach, describe, expect, it, vi } from "vitest";

const syncCuotas = vi.fn();
vi.mock("@/lib/cuotas-sync", () => ({ syncCuotas: (...a: unknown[]) => syncCuotas(...a) }));

import { GET } from "./route";

const req = (auth?: string) =>
  new Request("http://localhost/api/cron/cuotas-sync", { headers: auth ? { authorization: auth } : {} });

describe("GET /api/cron/cuotas-sync", () => {
  beforeEach(() => {
    syncCuotas.mockReset();
    process.env.CRON_SECRET = "cron-123";
  });

  it("401 sin secreto y no toca datos", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer otro"))).status).toBe(401);
    expect(syncCuotas).not.toHaveBeenCalled();
  });

  it("200 con la corrida completa", async () => {
    syncCuotas.mockResolvedValue({ ok: true, config: { ok: true }, planes: { ok: true, medios: [] } });
    const r = await GET(req("Bearer cron-123"));
    expect(r.status).toBe(200);
    expect(syncCuotas).toHaveBeenCalledWith("cron");
  });

  it("corrida con fallos → 500 (queda en los logs del cron)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    syncCuotas.mockResolvedValue({ ok: false, config: { ok: false, error: "x" }, planes: { ok: true, medios: [] } });
    expect((await GET(req("Bearer cron-123"))).status).toBe(500);
  });
});
