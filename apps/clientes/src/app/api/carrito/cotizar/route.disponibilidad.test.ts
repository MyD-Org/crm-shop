import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Flag `disponibilidad-sucursal` en la cotización del carrito: prendido, cotiza con la UNIÓN de las
 * sucursales y suma `disponibilidad` (envío y retiro por local, por producto); la provincia elegida
 * en el checkout define la zona. Apagado: la respuesta es la de siempre, sin `disponibilidad`.
 */
const cotizar = vi.fn();
const disponibilidadParaMostrar = vi.fn();
let estadoDisp = false;
const disp = {
  zona: "sede-a",
  activas: ["sede-a", "sede-b"],
  contarEn: ["sede-a"],
  stockHeredado: "sede-a",
};

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: null, cliente: null }),
  idPriceListCliente: async () => undefined,
}));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/zona-servidor", () => ({
  dispDelVisitante: async () => (estadoDisp ? disp : undefined),
}));
vi.mock("@/lib/disponibilidad-vista", () => ({
  contextoParaProvincia: async (base: typeof disp, provincia: string | null) =>
    provincia === "cordoba" ? { ...base, zona: "sede-b" } : base,
  // como la real: sin contexto (flag apagado) no hay nada que mostrar.
  disponibilidadParaMostrar: async (...a: unknown[]) =>
    a[1] ? disponibilidadParaMostrar(...a) : null,
}));

import { POST } from "./route";

const pedido = (extra: Record<string, unknown> = {}) =>
  new Request("https://tienda.example/api/carrito/cotizar", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.9",
    },
    body: JSON.stringify({ items: [{ id: "1", qty: 2 }], ...extra }),
  });

beforeEach(() => {
  estadoDisp = false;
  cotizar.mockReset();
  cotizar.mockResolvedValue({
    lineas: [],
    subtotal: 1,
    iva: 0,
    costoEnvio: 0,
    total: 1,
    hayProblemas: false,
  });
  disponibilidadParaMostrar.mockReset();
  disponibilidadParaMostrar.mockResolvedValue({
    productos: { "1": { servible: true, envio: null, retiro: null } },
    locales: [{ slug: "sede-a", nombre: "Sede A" }],
  });
});

describe("POST /api/carrito/cotizar — disponibilidad por sucursal", () => {
  it("apagado: sin contexto y sin `disponibilidad` en la respuesta", async () => {
    const body = await (await POST(pedido())).json();
    expect(cotizar.mock.calls[0][1].disp).toBeUndefined();
    expect(body.disponibilidad).toBeUndefined();
    expect(disponibilidadParaMostrar).not.toHaveBeenCalled();
  });

  it("prendido: cotiza con la unión y devuelve la disponibilidad por producto", async () => {
    estadoDisp = true;
    const body = await (await POST(pedido())).json();
    expect(cotizar.mock.calls[0][1].disp.contarEn).toEqual([
      "sede-a",
      "sede-b",
    ]);
    expect(body.disponibilidad.productos["1"]).toBeDefined();
    expect(body.disponibilidad.locales).toEqual([
      { slug: "sede-a", nombre: "Sede A" },
    ]);
    // ids y cantidades pedidas
    expect(disponibilidadParaMostrar.mock.calls[0][0]).toEqual(["1"]);
    expect(disponibilidadParaMostrar.mock.calls[0][2]).toEqual({ "1": 2 });
  });

  it("la provincia del checkout cambia la zona con la que se calcula", async () => {
    estadoDisp = true;
    await POST(pedido({ provincia: "Córdoba" }));
    expect(disponibilidadParaMostrar.mock.calls[0][1].zona).toBe("sede-b");
  });
});
