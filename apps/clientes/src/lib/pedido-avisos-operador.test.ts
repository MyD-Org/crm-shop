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
vi.mock("./medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => [] }));
vi.mock("./contacto-pedido-repo", () => ({ contactoDeSucursal: async () => null }));
const enviarEmail = vi.fn();
vi.mock("./email", () => ({ enviarEmail: (o: unknown) => enviarEmail(o) }));

import { avisarCobro, avisarOperadorPedidoNuevo, avisarPedidoRecibido, avisoOperadorAlCrear } from "./pedido-avisos";

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
      [enLinea], // mail al comprador: pedido
      [{ nombre: "Lámpara", cantidad: "2" }], // sus líneas
      [enLinea], // mail al local: pedido
      [{ nombre: "Centro", emailPedidos: "centro@tienda.cliente.example" }],
      [{ receiptsEmail: "" }],
      [{ nombre: "Lámpara", cantidad: "2" }],
    );
    await avisarCobro("p1", { antes: "pendiente", despues: "pagado", reversion: false, referencia: "r1" });
    expect(enviarEmail).toHaveBeenCalledTimes(2);
    expect(enviarEmail.mock.calls[0][0].to).toBe("ana@cliente.example");
    expect(enviarEmail.mock.calls[0][0].subject).toContain("y pago recibidos");
    expect(enviarEmail.mock.calls[0][0].text).toContain("Lámpara");
    expect(enviarEmail.mock.calls[0][0].idempotencyKey).toBe("pedido/p1/pago_recibido");
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

  it("dos aprobaciones con otra referencia usan la misma clave: un solo mail de confirmación", async () => {
    for (const referencia of ["r1", "r2"]) {
      colas.length = 0;
      colas.push([{ ...PEDIDO, pagoMetodo: "mercadopago" }], [], [{ ...PEDIDO, pagoMetodo: "mercadopago" }], [], [], []);
      await avisarCobro("p1", { antes: "pendiente", despues: "pagado", reversion: false, referencia });
    }
    const claves = enviarEmail.mock.calls.map((c) => c[0].idempotencyKey).filter((k: string) => k.includes("pago_recibido"));
    expect(new Set(claves).size).toBe(1);
  });

  it("el pago rechazado lleva el enlace para reintentar", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://tienda.cliente.example";
    colas.length = 0;
    colas.push([{ ...PEDIDO, pagoMetodo: "mercadopago", pagoEstado: "fallido" }]);
    await avisarCobro("p1", { antes: "pendiente", despues: "fallido", reversion: false, referencia: "r1" });
    expect(enviarEmail.mock.calls[0][0].html).toContain("https://tienda.cliente.example/checkout");
  });

  it("al crear un pedido con cobro en línea no sale el mail de pedido recibido", async () => {
    colas.length = 0;
    colas.push([{ ...PEDIDO, pagoMetodo: "mercadopago" }]);
    await avisarPedidoRecibido("p1");
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it("sin cobro en línea sí sale al crear", async () => {
    colas.length = 0;
    colas.push([PEDIDO], [{ nombre: "Lámpara", cantidad: "2" }]);
    await avisarPedidoRecibido("p1");
    expect(enviarEmail).toHaveBeenCalledTimes(1);
    expect(enviarEmail.mock.calls[0][0].idempotencyKey).toBe("pedido/p1/recibido");
  });
});
