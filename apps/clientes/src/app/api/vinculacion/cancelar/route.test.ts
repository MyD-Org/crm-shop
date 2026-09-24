import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const cancelarVinculacion = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/lib/vinculacion", () => ({ cancelarVinculacion: (...a: unknown[]) => cancelarVinculacion(...a) }));

import { POST } from "./route";

beforeEach(() => {
  auth.mockReset();
  cancelarVinculacion.mockReset();
  cancelarVinculacion.mockResolvedValue(undefined);
});

describe("POST /api/vinculacion/cancelar", () => {
  it("sin sesión: 401 sin tocar nada", async () => {
    auth.mockResolvedValue({ userId: null });
    expect((await POST()).status).toBe(401);
    expect(cancelarVinculacion).not.toHaveBeenCalled();
  });

  it("con sesión: anula los códigos del usuario", async () => {
    auth.mockResolvedValue({ userId: "user_1" });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(cancelarVinculacion).toHaveBeenCalledWith("user_1");
  });
});
