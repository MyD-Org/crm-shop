import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const verificarCodigo = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/lib/vinculacion", () => ({ verificarCodigo: (...a: unknown[]) => verificarCodigo(...a) }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/vinculacion/verificar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  auth.mockReset();
  verificarCodigo.mockReset();
  auth.mockResolvedValue({ userId: "user_1" });
});

describe("POST /api/vinculacion/verificar", () => {
  it("sin sesión: 401 sin verificar nada", async () => {
    auth.mockResolvedValue({ userId: null });
    expect((await post({ codigo: "123456" })).status).toBe(401);
    expect(verificarCodigo).not.toHaveBeenCalled();
  });

  it("body inválido: 400", async () => {
    expect((await post("{")).status).toBe(400);
  });

  it("código correcto: devuelve la cuenta", async () => {
    verificarCodigo.mockResolvedValue({ ok: true, razonSocial: "Cliente Ejemplo SA", documento: "30712345679" });
    const res = await post({ codigo: " 123456 " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, razonSocial: "Cliente Ejemplo SA", documento: "30712345679" });
    expect(verificarCodigo).toHaveBeenCalledWith("user_1", "123456");
  });

  it("código incorrecto: 400 con el detalle", async () => {
    verificarCodigo.mockResolvedValue({ ok: false, detalle: "Código incorrecto. Le quedan 4 intentos." });
    const res = await post({ codigo: "000000" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Código incorrecto. Le quedan 4 intentos." });
  });
});
