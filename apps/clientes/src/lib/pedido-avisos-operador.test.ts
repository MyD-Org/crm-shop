import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aviso al local por pedido nuevo (`avisarOperadorPedidoNuevo`). La base se simula con una cola
 * de resultados de `select()` en el orden en que la función consulta: pedido, sucursal, tenant,
 * líneas. Datos ficticios, dominios .example.
 */

const colas: unknown[][] = [];
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => {
      const chain: Record<string, unknown> = {};
      const fila = () => colas.shift() ?? [];
      for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
      chain.limit = () => Promise.resolve(fila());
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(fila()).then(res);
      return chain;
    },
  }),
}));
vi.mock("./tenant", () => ({ shopTenantId: () => "tenant-a" }));
vi.mock("./cuenta-corriente/tenant-cc", () => ({ datosTenant: async () => ({ nombre: "Tienda Demo" }) }));
const enviarEmail = vi.fn();
vi.mock("./email", () => ({ enviarEmail: (o: unknown) => enviarEmail(o) }));

import { avisarCobro, avisarOperadorPedidoNuevo, avisoOperadorAlCrear } from "./pedido-avisos";

const PEDIDO = {
  id: "p1",
  numero: 42,
  sucursal: "centro",
  contactoNombre: "Ana",
  contactoTelefono: "3757 400000",
  clienteEmail: "ana@cliente.example",
  entregaTipo: "retiro",
  entregaCiudad: null,
  entregaDireccion: null,
  pagoMetodo: "transferencia",
  total: "12100",
};

function cargar(opts: { sucursalEmail: string | null; receipts: string }) {
  colas.length = 0;
  colas.push(
    [PEDIDO],
    [{ nombre: "Centro", emailPedidos: opts.sucursalEmail }],
    [{ receiptsEmail: opts.receipts }],
    [{ nombre: "Lámpara", cantidad: "2" }],
  );
}

beforeEach(() => {
  enviarEmail.mockReset();
  enviarEmail.mockResolvedValue({ ok: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("avisarOperadorPedidoNuevo", () => {
  it("manda al email de la sucursal, con idempotencyKey por pedido y reply-to del comprador", async () => {
    cargar({ sucursalEmail: "centro@tienda.cliente.example", receipts: "pagos@tienda.cliente.example" });
    await avisarOperadorPedidoNuevo("p1");
    expect(enviarEmail).toHaveBeenCalledTimes(1);
    const o = enviarEmail.mock.calls[0][0];
    expect(o.to).toBe("centro@tienda.cliente.example");
    expect(o.idempotencyKey).toBe("pedido/p1/operador");
    expect(o.replyTo).toBe("ana@cliente.example");
    expect(o.subject).toContain("PED-00000042");
  });

  it("sin email de sucursal usa el de comprobantes de la empresa", async () => {
    cargar({ sucursalEmail: null, receipts: "pagos@tienda.cliente.example" });
    await avisarOperadorPedidoNuevo("p1");
    expect(enviarEmail.mock.calls[0][0].to).toBe("pagos@tienda.cliente.example");
  });

  it("sin ningún destino no envía y registra el motivo", async () => {
    cargar({ sucursalEmail: null, receipts: "" });
    await avisarOperadorPedidoNuevo("p1");
    expect(enviarEmail).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("nunca lanza, aunque falle el envío o la lectura", async () => {
    cargar({ sucursalEmail: "centro@tienda.cliente.example", receipts: "" });
    enviarEmail.mockRejectedValue(new Error("red"));
    await expect(avisarOperadorPedidoNuevo("p1")).resolves.toBeUndefined();
    colas.length = 0;
    await expect(avisarOperadorPedidoNuevo("p1")).resolves.toBeUndefined();
  });
});

describe("aviso al local con pago en línea", () => {
  it("al crear el pedido se avisa salvo con pago en línea", () => {
    expect(avisoOperadorAlCrear("transferencia")).toBe(true);
    expect(avisoOperadorAlCrear("efectivo")).toBe(true);
    expect(avisoOperadorAlCrear("mercadopago")).toBe(false);
  });

  it("cuando se aprueba el cobro sale el mail al comprador y después el del local", async () => {
    const enLinea = { ...PEDIDO, pagoMetodo: "mercadopago", pagoEstado: "pagado" };
    colas.length = 0;
    colas.push(
      [enLinea], // mail al comprador
      [enLinea],
      [{ nombre: "Centro", emailPedidos: "centro@tienda.cliente.example" }],
      [{ receiptsEmail: "" }],
      [{ nombre: "Lámpara", cantidad: "2" }],
    );
    await avisarCobro("p1", { antes: "pendiente", despues: "pagado", reversion: false, referencia: "r1" });
    expect(enviarEmail).toHaveBeenCalledTimes(2);
    expect(enviarEmail.mock.calls[0][0].to).toBe("ana@cliente.example");
    expect(enviarEmail.mock.calls[1][0].to).toBe("centro@tienda.cliente.example");
    expect(enviarEmail.mock.calls[1][0].idempotencyKey).toBe("pedido/p1/operador");
  });

  it("un cobro rechazado no avisa al local", async () => {
    colas.length = 0;
    colas.push([{ ...PEDIDO, pagoMetodo: "mercadopago", pagoEstado: "fallido" }]);
    await avisarCobro("p1", { antes: "pendiente", despues: "fallido", reversion: false, referencia: "r1" });
    expect(enviarEmail).toHaveBeenCalledTimes(1);
    expect(enviarEmail.mock.calls[0][0].to).toBe("ana@cliente.example");
  });
});
