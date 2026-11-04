import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...a: unknown[]) => revalidateTag(...a),
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

const despues: Array<() => Promise<void>> = [];
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => despues.push(fn),
}));
const procesarAvisos = vi.fn();
vi.mock("@/lib/aviso-reingreso-cron", () => ({ procesarAvisos: () => procesarAvisos() }));

import { POST } from "./route";

const req = (auth?: string) =>
  new Request("http://localhost/api/internal/catalogo/revalidar", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

/**
 * Aviso del CRM (fin de sync, drenaje de stock con cambios, overlay). El CRM
 * exige 2xx + JSON `{ ok: true }` (contrato crm-shop-base/v1): si la cortina
 * del gate o un error devolvieran otra cosa, lo registra como fallido.
 */
describe("POST /api/internal/catalogo/revalidar", () => {
  beforeEach(() => {
    revalidateTag.mockReset();
    revalidatePath.mockReset();
    procesarAvisos.mockReset();
    despues.length = 0;
    process.env.SHOP_CRM_SECRET = "int-456";
  });

  it("401 sin secreto válido y no invalida nada", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer nope"))).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(despues).toHaveLength(0);
  });

  it("después de responder corre el barrido del aviso de reingreso", async () => {
    procesarAvisos.mockResolvedValue({ omitido: false, revisados: 1, enviados: 1, errores: 0, purgados: 0 });
    expect((await POST(req("Bearer int-456"))).status).toBe(200);
    expect(procesarAvisos).not.toHaveBeenCalled();
    expect(despues).toHaveLength(1);
    await despues[0]();
    expect(procesarAvisos).toHaveBeenCalledTimes(1);
  });

  it("un error del barrido no se propaga", async () => {
    procesarAvisos.mockRejectedValue(new Error("boom"));
    await POST(req("Bearer int-456"));
    await expect(despues[0]()).resolves.toBeUndefined();
  });

  it("vence el tag catalogo con expire 0 y responde { ok: true }", async () => {
    const r = await POST(req("Bearer int-456"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("catalogo", { expire: 0 });
    // El shell no tiene datos del catálogo: no hace falta tirar el layout.
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
