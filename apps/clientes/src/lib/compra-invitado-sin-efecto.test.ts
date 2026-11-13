import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";

/**
 * S1-6 / X1: con la rebanada S1 desplegada el flag `compra-invitado` no cambia NADA, ni siquiera
 * encendido (el cableado de las rutas es de S2a y el de la página de S2b). Un anónimo sigue yendo a
 * `/ingresar` desde el checkout y `POST /api/pedidos` anónimo sigue respondiendo 401.
 */

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: null, cliente: null, esAdmin: false, nombrePila: null }),
}));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => true }));
vi.mock("@/lib/pedidos", () => ({}));
vi.mock("@/lib/facturacion-db", () => ({}));
vi.mock("@/lib/pedido-avisos", () => ({}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/sucursales-datos", () => ({ reglasVentaCacheadas: async () => [] }));
vi.mock("@/lib/medios-pago-datos", () => ({ mediosOfreciblesComprador: async () => [] }));
vi.mock("@/lib/pagos/tarjetas-aceptadas-mp", () => ({ getTarjetasMercadoPago: async () => [] }));
vi.mock("@/components/CheckoutClient", () => ({ CheckoutClient: () => null }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));

beforeEach(() => {
  setFlag("compra-invitado", true);
});

describe("compra-invitado encendido en S1 no cambia nada", () => {
  it("/checkout anónimo redirige a /ingresar con el retorno", async () => {
    const { default: CheckoutPage } = await import("@/app/checkout/page");
    await expect(CheckoutPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "REDIRECT:/ingresar?redirect_url=%2Fcheckout",
    );
  });

  it("POST /api/pedidos anónimo responde 401 como hoy", async () => {
    const { POST } = await import("@/app/api/pedidos/route");
    const res = await POST(
      new Request("https://shop.example/api/pedidos", {
        method: "POST",
        headers: { "content-type": "application/json", "x-pedido-token": "v1.basura" },
        body: JSON.stringify({ invitado: true }),
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "No autorizado" });
  });
});
