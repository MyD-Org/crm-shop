import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Comprobante de transferencia POR PEDIDO (`POST /api/mi-cuenta/comprobantes` con `pedidoId`),
 * también para compradores SIN cuenta corriente: el dueño sale de la identidad, el pedido tiene
 * que ser suyo, sólo transferencia con pago pendiente, método fijado a `transferencia`, tope de
 * 5 por pedido y los límites de hora/día por comprador. Repo, pedidos y R2 falsos.
 */

const identidad = vi.fn();
const acceso = vi.fn(async () => true);
const r2 = { presignPut: vi.fn() };
const getR2 = vi.fn<() => typeof r2 | null>();
const crearSubiendo = vi.fn();
const contarRecientes = vi.fn();
const contarDelPedido = vi.fn();
const getPedidoParaComprobante = vi.fn();

vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/acceso-facturacion", () => ({ accesoFacturacion: () => acceso() }));
vi.mock("@/lib/r2", () => ({ getComprobantesR2: () => getR2() }));
vi.mock("@/lib/tenant", () => ({ shopTenantId: () => "tenant-a" }));
vi.mock("@/lib/contactos-espejo", () => ({ contactoPorId: vi.fn(async () => null) }));
vi.mock("@/lib/pedidos", () => ({
  getPedidoParaComprobante: (...a: unknown[]) => getPedidoParaComprobante(...a),
}));
vi.mock("@/lib/comprobantes/repo", () => ({
  crearSubiendo: (...a: unknown[]) => crearSubiendo(...a),
  contarRecientes: (...a: unknown[]) => contarRecientes(...a),
  contarDelPedido: (...a: unknown[]) => contarDelPedido(...a),
  listarDelCliente: vi.fn(),
}));

import { POST } from "./route";

const ID = "11111111-2222-4333-8444-555555555555";
const PEDIDO = "99999999-2222-4333-8444-555555555555";

function body(overrides: Record<string, unknown> = {}) {
  return {
    pedidoId: PEDIDO,
    amount: "150000",
    paidOn: "2025-12-01",
    file: { name: "comprobante.pdf", size: 1_000_000, contentType: "application/pdf" },
    ...overrides,
  };
}

const post = (b: unknown) =>
  POST(new Request("http://localhost/api/mi-cuenta/comprobantes", { method: "POST", body: JSON.stringify(b) }));

let usuario = 0;
/** Un usuario distinto por test: el límite por hora vive en memoria del proceso. */
function sinCuentaCorriente() {
  usuario++;
  identidad.mockResolvedValue({ clerkUserId: `user_${usuario}`, cliente: null });
  return `user_${usuario}`;
}

const pedido = (over: Record<string, unknown> = {}) => ({
  id: PEDIDO,
  numero: "PED-00000042",
  total: 150000,
  pagoMetodo: "transferencia",
  pagoEstado: "pendiente",
  estado: "pendiente",
  clienteRazonSocial: null,
  facturacionRazonSocial: "Compras Demo SRL",
  contactoNombre: "Carla Compradora",
  clienteCuit: null,
  facturacionNroDoc: "30123456780",
  clienteEmail: "carla@cliente.example",
  ...over,
});

beforeEach(() => {
  for (const f of [identidad, getR2, r2.presignPut, crearSubiendo, contarRecientes, contarDelPedido, getPedidoParaComprobante]) {
    f.mockReset();
  }
  acceso.mockResolvedValue(true);
  getR2.mockReturnValue(r2);
  contarRecientes.mockResolvedValue(0);
  contarDelPedido.mockResolvedValue(0);
  crearSubiendo.mockResolvedValue({ id: ID });
  getPedidoParaComprobante.mockResolvedValue(pedido());
  r2.presignPut.mockResolvedValue({
    url: "https://acc.r2.cloudflarestorage.com/bucket/tmp/receipts/tenant-a/x?X-Amz-Signature=s",
    headers: { "content-type": "application/pdf" },
    expiresAt: new Date("2026-09-12T13:10:00.000Z"),
  });
});

describe("POST /api/mi-cuenta/comprobantes con pedidoId", () => {
  it("comprador SIN cuenta corriente sube: fila con codigocliente NULL, pedido y usuario, datos del pedido", async () => {
    const user = sinCuentaCorriente();
    const res = await post(body());
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await res.json()).id).toBe(ID);

    // El pedido se busca con las dos llaves del dueño (usuario y, si hubiera, cuenta corriente).
    expect(getPedidoParaComprobante).toHaveBeenCalledWith(PEDIDO, { clerkUserId: user, clienteCodigo: undefined });
    const [tenant, alta] = crearSubiendo.mock.calls[0] as [string, Record<string, unknown>];
    expect(tenant).toBe("tenant-a");
    expect(alta).toMatchObject({
      codigocliente: null,
      shopOrderId: PEDIDO,
      clerkUserId: user,
      razonsocial: "Compras Demo SRL",
      cuit: "30123456780",
      clientEmail: "carla@cliente.example",
      method: "transferencia",
      amount: "150000",
    });
    expect(r2.presignPut).toHaveBeenCalledTimes(1);
  });

  it("el método se fija a transferencia aunque el body diga otro (o no lo traiga)", async () => {
    sinCuentaCorriente();
    await post(body({ method: "efectivo" }));
    expect(crearSubiendo.mock.calls[0]?.[1]).toMatchObject({ method: "transferencia", methodOther: null });
  });

  it("vinculado (aunque sea de contado) conserva su codigocliente además del pedido y el usuario", async () => {
    identidad.mockResolvedValue({
      clerkUserId: "user_77",
      cliente: { codigocliente: "42", razonsocial: "Cliente Demo SRL", cuit: "30123456780", email: "c@empresa.cliente.example", origen: "vinculacion" },
    });
    acceso.mockResolvedValue(false); // de contado: no ve cuenta corriente, pero sí puede informar su pedido
    const res = await post(body());
    expect(res.status).toBe(201);
    expect(getPedidoParaComprobante).toHaveBeenCalledWith(PEDIDO, { clerkUserId: "user_77", clienteCodigo: "42" });
    expect(crearSubiendo.mock.calls[0]?.[1]).toMatchObject({
      codigocliente: "42",
      shopOrderId: PEDIDO,
      clerkUserId: "user_77",
      razonsocial: "Cliente Demo SRL",
      cuit: "30123456780",
    });
    expect(contarRecientes).toHaveBeenCalledWith("tenant-a", "42", expect.any(Date));
  });

  it("anónimo: 401 en usted y nada se crea", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    const res = await post(body());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Inicie sesión para continuar." });
    expect(crearSubiendo).not.toHaveBeenCalled();
  });

  it("pedido ajeno o inexistente: 404 en usted y nada se crea", async () => {
    sinCuentaCorriente();
    getPedidoParaComprobante.mockResolvedValue(null);
    const res = await post(body());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No encontramos el pedido." });
    expect(crearSubiendo).not.toHaveBeenCalled();
    expect(r2.presignPut).not.toHaveBeenCalled();
  });

  it("pedidoId que no es un UUID: 404 sin consultar la base", async () => {
    sinCuentaCorriente();
    const res = await post(body({ pedidoId: "no-es-uuid" }));
    expect(res.status).toBe(404);
    expect(getPedidoParaComprobante).not.toHaveBeenCalled();
  });

  it.each([
    ["no_transferencia", { pagoMetodo: "mercadopago" }, "Este pedido no se paga por transferencia."],
    ["pagado", { pagoEstado: "pagado" }, "Este pedido ya figura como pagado."],
    ["cancelado", { estado: "cancelado" }, "Este pedido está cancelado: no puede informar un pago."],
  ])("pedido %s: 409 en usted y nada se crea", async (_n, over, mensaje) => {
    sinCuentaCorriente();
    getPedidoParaComprobante.mockResolvedValue(pedido(over));
    const res = await post(body());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: mensaje });
    expect(crearSubiendo).not.toHaveBeenCalled();
  });

  it("tope de 5 comprobantes por pedido: 429 con el mensaje de límite y nada se crea", async () => {
    sinCuentaCorriente();
    contarDelPedido.mockResolvedValue(5);
    const res = await post(body());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("Superó el límite de comprobantes. Inténtelo más tarde.");
    expect(contarDelPedido).toHaveBeenCalledWith("tenant-a", PEDIDO);
    expect(crearSubiendo).not.toHaveBeenCalled();
  });

  it("con 4 ya informados todavía acepta el 5.º", async () => {
    sinCuentaCorriente();
    contarDelPedido.mockResolvedValue(4);
    expect((await post(body())).status).toBe(201);
  });

  it("límite por hora del comprador sin cuenta corriente: el 11.º ⇒ 429", async () => {
    sinCuentaCorriente();
    for (let i = 0; i < 10; i++) expect((await post(body())).status).toBe(201);
    const res = await post(body());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(
      "Informó demasiados comprobantes en la última hora. Inténtelo de nuevo más tarde.",
    );
    expect(crearSubiendo).toHaveBeenCalledTimes(10);
  });

  it("tope diario contado en la base por usuario de Clerk", async () => {
    const user = sinCuentaCorriente();
    contarRecientes.mockResolvedValue(20);
    const res = await post(body());
    expect(res.status).toBe(429);
    expect(contarRecientes).toHaveBeenCalledWith("tenant-a", { clerkUserId: user }, expect.any(Date));
    expect(crearSubiendo).not.toHaveBeenCalled();
  });

  it("validación de campos igual que el informe de siempre (400 con fields)", async () => {
    sinCuentaCorriente();
    const res = await post(body({ amount: "0" }));
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).fields)).toEqual(["amount"]);
    expect(crearSubiendo).not.toHaveBeenCalled();
  });

  it("sin pedidoId, un comprador sin cuenta corriente sigue sin acceso (404 como antes)", async () => {
    sinCuentaCorriente();
    const { pedidoId: _omit, ...sinPedido } = body();
    void _omit;
    expect((await post({ ...sinPedido, method: "transferencia" })).status).toBe(404);
    expect(crearSubiendo).not.toHaveBeenCalled();
  });
});
