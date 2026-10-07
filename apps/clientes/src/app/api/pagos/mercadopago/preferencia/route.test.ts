import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoParaPago } from "@/lib/pedidos";

const crearPreferencia = vi.fn();
let pedido: PedidoParaPago | null;
let configurado = true;
let sesion = true;

vi.mock("@/lib/auth", () => ({
  identidadActual: async () =>
    sesion ? { clerkUserId: "user_1", cliente: null, email: "ana@cliente.example" } : { clerkUserId: null, cliente: null },
}));
vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedidos", async (original) => ({
  motivoNoCobrable: (await original<typeof import("@/lib/pedidos")>()).motivoNoCobrable,
  getPedidoParaPago: async () => pedido,
}));
vi.mock("@/lib/pagos/mercadopago", async (original) => ({
  ...(await original<typeof import("@/lib/pagos/mercadopago")>()),
  mercadoPagoConfigurado: () => configurado,
  crearPreferencia: (...a: unknown[]) => crearPreferencia(...a),
}));

import { POST } from "./route";

const pedir = (body: unknown = { pedidoId: "p1" }) =>
  POST(
    new Request("https://tienda.example/api/pagos/mercadopago/preferencia", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  configurado = true;
  sesion = true;
  crearPreferencia.mockReset().mockResolvedValue("pref-123");
  pedido = {
    id: "p1", numero: "000001", total: 120000, pagoEstado: "pendiente", pagoMetodo: "mercadopago",
    clienteEmail: "ana@cliente.example", facturacionTipoDoc: null, facturacionNroDoc: null,
    cuotas: null, estado: "pendiente", creadoEn: new Date(),
  };
});

describe("POST /api/pagos/mercadopago/preferencia", () => {
  it("crea la preferencia desde el pedido congelado y devuelve sólo el id", async () => {
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ preferenceId: "pref-123" });
    const pref = crearPreferencia.mock.calls[0][0];
    expect(pref.items[0].unit_price).toBe(120000);
    expect(pref.external_reference).toBe("p1");
    expect(pref.purpose).toBe("wallet_purchase");
    expect(pref.payment_methods).toEqual({ installments: 1 });
    expect(pref.back_urls.success).toBe("https://tienda.example/checkout?pedido=p1&pago=mp");
  });

  it("el monto no se toma del body", async () => {
    await pedir({ pedidoId: "p1", total: 1, monto: 1 });
    expect(crearPreferencia.mock.calls[0][0].items[0].unit_price).toBe(120000);
  });

  it("un pago (cuotas 1) también la ofrece", async () => {
    pedido!.cuotas = 1;
    expect((await pedir()).status).toBe(200);
  });

  it("con 2 o más cuotas congeladas: 409 y no se crea nada", async () => {
    pedido!.cuotas = 3;
    const res = await pedir();
    expect(res.status).toBe(409);
    expect(crearPreferencia).not.toHaveBeenCalled();
  });

  it("sin sesión: 401", async () => {
    sesion = false;
    expect((await pedir()).status).toBe(401);
    expect(crearPreferencia).not.toHaveBeenCalled();
  });

  it("sin credenciales de Mercado Pago: 409", async () => {
    configurado = false;
    expect((await pedir()).status).toBe(409);
    expect(crearPreferencia).not.toHaveBeenCalled();
  });

  it("pedido ajeno o inexistente: 404", async () => {
    pedido = null;
    expect((await pedir()).status).toBe(404);
  });

  it("pedido de otro medio de pago: 404", async () => {
    pedido!.pagoMetodo = "transferencia";
    expect((await pedir()).status).toBe(404);
    expect(crearPreferencia).not.toHaveBeenCalled();
  });

  it("pedido ya pagado: 409", async () => {
    pedido!.pagoEstado = "pagado";
    expect((await pedir()).status).toBe(409);
    expect(crearPreferencia).not.toHaveBeenCalled();
  });

  it("pedido cancelado: 409", async () => {
    pedido!.estado = "cancelado";
    expect((await pedir()).status).toBe(409);
  });

  it("falla de Mercado Pago: 502 sin filtrar el detalle", async () => {
    crearPreferencia.mockRejectedValue(new Error("secreto interno"));
    const res = await pedir();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secreto");
  });

  it("sin pedidoId: 400", async () => {
    expect((await pedir({})).status).toBe(400);
  });
});
