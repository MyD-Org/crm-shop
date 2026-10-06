import { beforeEach, describe, expect, it, vi } from "vitest";

const identidadActual = vi.fn();
const paywayConfigPublica = vi.fn();

vi.mock("@/lib/auth", () => ({ identidadActual: () => identidadActual() }));
vi.mock("@/lib/pagos/payway", () => ({ paywayConfigPublica: () => paywayConfigPublica() }));

import { GET } from "./route";

beforeEach(() => {
  identidadActual.mockReset();
  paywayConfigPublica.mockReset();
  identidadActual.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
  paywayConfigPublica.mockReturnValue({ publicKey: "clave-publica-de-prueba", baseUrl: "https://payway.example" });
});

describe("GET /api/pagos/payway-config", () => {
  it("devuelve la key pública y la base, sin cachear", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ publicKey: "clave-publica-de-prueba", baseUrl: "https://payway.example" });
    expect(r.headers.get("Cache-Control")).toMatch(/no-store/);
  });

  it("sin sesión -> 401", async () => {
    identidadActual.mockResolvedValue({ clerkUserId: null, cliente: null });
    const r = await GET();
    expect(r.status).toBe(401);
    expect(paywayConfigPublica).not.toHaveBeenCalled();
  });

  it("sin configuración -> 409 en usted", async () => {
    paywayConfigPublica.mockReturnValue(null);
    const r = await GET();
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error).toMatch(/no están disponibles/);
  });
});
