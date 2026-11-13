import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANONIMO, PA, describirMatrizAislamiento, pedido, tokenDe } from "@/test/aislamiento-invitado";
import { setFlag } from "@/test/flags";
import type { DuenoPedidos } from "@/lib/pedidos";

const { identidadActual, permitirAsync, repoLlamadas, crearPreferencia, pedidoActual } = vi.hoisted(() => ({
  identidadActual: vi.fn(),
  permitirAsync: vi.fn(),
  repoLlamadas: [] as DuenoPedidos[],
  crearPreferencia: vi.fn(),
  pedidoActual: { pagoEstado: "pendiente" as string },
}));
vi.mock("@/lib/auth", () => ({ identidadActual }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync }));
vi.mock("@/lib/pagos", () => ({ procesadorConfigurado: () => true }));
vi.mock("@/lib/marca", () => ({ getMarca: async () => ({ nombre: "Tienda" }) }));
vi.mock("@/lib/pagos/opcion-cobro-guard", () => ({ rechazoPorOpcionDeCobro: async () => null }));
vi.mock("@/lib/pagos/mercadopago", async (orig) => ({
  ...(await orig<typeof import("@/lib/pagos/mercadopago")>()),
  crearPreferencia: (...a: unknown[]) => crearPreferencia(...a),
}));
vi.mock("@/lib/pagos/cuentas-sucursales", () => ({
  candidatasDelPedido: async () => ({ prevista: "igz", candidatas: [{ cuenta: "igz", configurada: true, rechazada: false }] }),
}));
vi.mock("@/lib/pedidos", async (original) => {
  const real = await original<typeof import("@/lib/pedidos")>();
  return {
    ...real,
    getPedidoParaPago: async (id: string, dueno: DuenoPedidos) => {
      repoLlamadas.push(dueno);
      return (await import("@/test/aislamiento-invitado")).abre(id, dueno)
        ? {
            id,
            numero: "PED-00000001",
            total: 1000,
            pagoMetodo: "mercadopago",
            pagoEstado: pedidoActual.pagoEstado,
            estado: "pendiente",
            creadoEn: new Date(),
            formaCobro: null,
            clienteEmail: "comprador@cliente.example",
          }
        : null;
    },
    registrarCuentaRechazada: vi.fn(),
  };
});

import { POST } from "./route";

const cuerpo = (pedidoId: string) => ({ pedidoId });

beforeEach(() => {
  pedidoActual.pagoEstado = "pagado";
  crearPreferencia.mockReset();
  crearPreferencia.mockResolvedValue("https://mp.example/checkout");
});

describirMatrizAislamiento({
  nombre: "POST /api/pagos/mercadopago/preferencia",
  identidad: identidadActual,
  permitir: permitirAsync,
  repoLlamadas,
  conCuerpo: true,
  llamar: ({ token, pedidoId, tokenEnCuerpo }) =>
    POST(pedido("/api/pagos/mercadopago/preferencia", { token, tokenEnCuerpo, cuerpo: cuerpo(pedidoId) })),
  esFeliz: async (r) => {
    // Pedido ya pagado: el handler llegó a la regla de negocio (409 `pagado`) sin crear preferencia.
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ motivo: "pagado" });
    expect(crearPreferencia).not.toHaveBeenCalled();
  },
});

describe("POST /api/pagos/mercadopago/preferencia: invitado", () => {
  beforeEach(() => {
    vi.stubEnv("PEDIDO_LINK_SECRET", "secreto-de-prueba-pedido-link-0123456789");
    vi.stubEnv("SHOP_TENANT_ID", "tenant-a.example");
    setFlag("compra-invitado", true);
    identidadActual.mockResolvedValue(ANONIMO);
    permitirAsync.mockResolvedValue(true);
    pedidoActual.pagoEstado = "pendiente";
  });

  it("la preferencia lleva el token del HEADER en las back_urls y el email del pedido como payer", async () => {
    const token = tokenDe(PA);
    const r = await POST(pedido("/api/pagos/mercadopago/preferencia", { token, cuerpo: cuerpo(PA) }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ url: "https://mp.example/checkout" });
    const pref = crearPreferencia.mock.calls[0][1];
    expect(pref.payer).toEqual({ email: "comprador@cliente.example" });
    for (const url of Object.values(pref.back_urls) as string[]) {
      expect(url).toContain(`pedido=${PA}`);
      expect(url).toContain(`&t=${encodeURIComponent(token)}`);
    }
    // El aviso de Mercado Pago (webhook) no lleva el token.
    expect(JSON.stringify(pref.notification_url ?? "")).not.toContain(token);
  });

  it("quien tiene sesión no lleva `t` en la URL de retorno", async () => {
    identidadActual.mockResolvedValue({ clerkUserId: "user_ana", cliente: null, email: "ana@cliente.example" });
    const { PC } = await import("@/test/aislamiento-invitado");
    await POST(pedido("/api/pagos/mercadopago/preferencia", { token: null, cuerpo: cuerpo(PC) }));
    const pref = crearPreferencia.mock.calls[0][1];
    expect(pref.back_urls.success).not.toContain("t=");
  });

  it("cuerpo ilegible: anónimo => 401 como hoy; con sesión => 400", async () => {
    const malo = (token: string | null) =>
      new Request("https://shop.example/api/pagos/mercadopago/preferencia", {
        method: "POST",
        headers: token ? { "x-pedido-token": token } : {},
        body: "{no",
      });
    expect((await POST(malo(tokenDe(PA)))).status).toBe(401);
    identidadActual.mockResolvedValue({ clerkUserId: "user_ana", cliente: null });
    expect((await POST(malo(null))).status).toBe(400);
  });
});
