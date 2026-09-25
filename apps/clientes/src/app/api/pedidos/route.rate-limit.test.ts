import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Techo de confirmaciones por comprador en POST /api/pedidos, con el
 * `permitir` real. El body va roto a propósito: el límite se evalúa antes de
 * leerlo, así que un request que pasa responde 400 y uno frenado, 429, sin
 * tener que simular la cotización ni el pedido.
 */

let identidad: {
  clerkUserId: string | null;
  cliente: { codigocliente: string } | null;
  email?: string;
};

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => identidad,
  idPriceListCliente: async () => undefined,
}));
vi.mock("@/lib/pedido-avisos", () => ({ avisarPedidoRecibido: vi.fn() }));

import { POST } from "./route";

const confirmar = () =>
  POST(
    new Request("https://tienda.example/api/pedidos", {
      method: "POST",
      body: "{no es json",
    }),
  );

beforeEach(() => {
  vi.useRealTimers();
});

describe("POST /api/pedidos — límite por comprador", () => {
  it("deja pasar 5 intentos por minuto y frena el sexto con 429 en usted", async () => {
    identidad = { clerkUserId: "user_limite_1", cliente: null };
    for (let i = 0; i < 5; i++) {
      expect((await confirmar()).status).toBe(400);
    }
    const r = await confirmar();
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("60");
    const { error } = await r.json();
    expect(error).toMatch(/Espere un minuto e inténtelo de nuevo/);
  });

  it("el límite es por comprador: otro usuario no queda frenado", async () => {
    identidad = { clerkUserId: "user_limite_2", cliente: null };
    for (let i = 0; i < 6; i++) await confirmar();
    identidad = { clerkUserId: "user_limite_3", cliente: null };
    expect((await confirmar()).status).toBe(400);
  });

  it("sin Clerk cuenta por el código de cliente de la cookie del CRM", async () => {
    identidad = { clerkUserId: null, cliente: { codigocliente: "limite-42" } };
    for (let i = 0; i < 5; i++) await confirmar();
    expect((await confirmar()).status).toBe(429);
  });

  it("se libera cuando pasa la ventana", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    identidad = { clerkUserId: "user_limite_4", cliente: null };
    for (let i = 0; i < 5; i++) await confirmar();
    expect((await confirmar()).status).toBe(429);
    vi.setSystemTime(new Date("2026-01-01T12:01:01Z"));
    expect((await confirmar()).status).toBe(400);
  });

  it("sin sesión responde 401 sin consumir el límite de nadie", async () => {
    identidad = { clerkUserId: null, cliente: null };
    expect((await confirmar()).status).toBe(401);
  });
});
