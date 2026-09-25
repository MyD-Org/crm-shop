import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sin sesión el carrito también cotiza, con la lista principal (L1): el
 * visitante ve el IVA y el total final. La sesión se exige recién para comprar.
 */

let identidad: { clerkUserId: string | null; cliente: { codigocliente: string } | null };
const cotizar = vi.fn();
const idPriceListCliente = vi.fn();

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => identidad,
  idPriceListCliente: (...a: unknown[]) => idPriceListCliente(...a),
}));
vi.mock("@/lib/cotizacion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: async () => false }));

import { POST } from "./route";

function pedido(ip = "203.0.113.7") {
  return new Request("https://tienda.example/api/carrito/cotizar", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ items: [{ id: "1", qty: 2 }] }),
  });
}

beforeEach(() => {
  identidad = { clerkUserId: null, cliente: null };
  cotizar.mockReset();
  cotizar.mockResolvedValue({
    lineas: [],
    subtotal: 1000,
    iva: 210,
    costoEnvio: 0,
    total: 1210,
    hayProblemas: false,
  });
  idPriceListCliente.mockReset();
  idPriceListCliente.mockResolvedValue("7");
});

describe("POST /api/carrito/cotizar", () => {
  it("sin sesión cotiza con la lista principal (sin idPriceList)", async () => {
    const r = await POST(pedido("203.0.113.1"));
    expect(r.status).toBe(200);
    expect((await r.json()).total).toBe(1210);
    expect(cotizar).toHaveBeenCalledWith([{ id: "1", qty: 2 }], {
      idPriceList: undefined,
      entregaTipo: "retiro",
    });
    expect(idPriceListCliente).not.toHaveBeenCalled();
  });

  it("con cliente vinculado cotiza con su lista", async () => {
    identidad = { clerkUserId: "user_1", cliente: { codigocliente: "C1" } };
    await POST(pedido("203.0.113.2"));
    expect(cotizar).toHaveBeenCalledWith(expect.any(Array), {
      idPriceList: "7",
      entregaTipo: "retiro",
    });
  });

  it("sin sesión el techo es por IP", async () => {
    for (let i = 0; i < 60; i++) expect((await POST(pedido("203.0.113.3"))).status).toBe(200);
    expect((await POST(pedido("203.0.113.3"))).status).toBe(429);
    // Otra IP no comparte el techo.
    expect((await POST(pedido("203.0.113.4"))).status).toBe(200);
  });
});
