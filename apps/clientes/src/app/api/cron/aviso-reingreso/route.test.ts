import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const procesarAvisos = vi.fn();
vi.mock("@/lib/aviso-reingreso-cron", () => ({ procesarAvisos: (...a: unknown[]) => procesarAvisos(...a) }));

import { GET } from "./route";

const pedir = (auth?: string) =>
  GET(new Request("https://tienda.example/api/cron/aviso-reingreso", auth ? { headers: { authorization: auth } } : {}));

describe("GET /api/cron/aviso-reingreso", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "secreto-de-prueba");
    procesarAvisos.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sin el secreto, 401 y no procesa nada", async () => {
    expect((await pedir()).status).toBe(401);
    expect((await pedir("Bearer otro")).status).toBe(401);
    expect(procesarAvisos).not.toHaveBeenCalled();
  });

  it("con CRON_SECRET sin configurar, 401", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await pedir("Bearer ")).status).toBe(401);
    expect(procesarAvisos).not.toHaveBeenCalled();
  });

  it("con el secreto, devuelve el resultado del barrido", async () => {
    procesarAvisos.mockResolvedValue({ omitido: true, revisados: 0, enviados: 0, errores: 0, purgados: 0 });
    const res = await pedir("Bearer secreto-de-prueba");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, omitido: true, revisados: 0, enviados: 0, errores: 0, purgados: 0 });
  });

  it("si el barrido lanza, 500 sin detalle", async () => {
    procesarAvisos.mockRejectedValue(new Error("secreto de la base"));
    const res = await pedir("Bearer secreto-de-prueba");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secreto de la base");
  });
});
