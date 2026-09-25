import { describe, expect, it } from "vitest";
import { armarMailPedido } from "./pedido-mail";
import { avisoDelCobro } from "./pedido-avisos";

const base = {
  numero: "PED-00000042",
  contactoNombre: "Ana <b>",
  comercio: "Tienda <Demo>",
  pedidosUrl: "https://tienda.cliente.example/mi-cuenta/pedidos",
};

describe("armarMailPedido", () => {
  it("recibido: asunto, saludo escapado, resumen y botón", () => {
    const m = armarMailPedido({
      ...base,
      aviso: "recibido",
      lineas: [{ nombre: "Lámpara <LED>", cantidad: 2 }],
      total: 12100,
      entrega: "Envío a domicilio",
      pago: "Transferencia bancaria",
    });
    expect(m.subject).toBe("Tienda <Demo> — Pedido PED-00000042 recibido");
    expect(m.html).toContain("Hola, Ana &lt;b&gt;:");
    expect(m.html).toContain("Lámpara &lt;LED&gt;");
    expect(m.html).not.toContain("<LED>");
    expect(m.html).toContain('href="https://tienda.cliente.example/mi-cuenta/pedidos"');
    expect(m.text).toContain("- Lámpara <LED> × 2");
    expect(m.text).toContain("Pago: Transferencia bancaria");
    expect(m.text).not.toContain("todavía no completó el pago");
  });

  it("recibido con Mercado Pago sin pagar: invita a completar el pago", () => {
    const m = armarMailPedido({ ...base, aviso: "recibido", pagoPendienteEnLinea: true });
    expect(m.text).toContain("Si todavía no completó el pago");
  });

  it("pago recibido y rechazado, sin resumen", () => {
    const ok = armarMailPedido({ ...base, aviso: "pago_recibido", lineas: [{ nombre: "X", cantidad: 1 }] });
    expect(ok.subject).toContain("pago recibido");
    expect(ok.text).not.toContain("- X");
    const mal = armarMailPedido({ ...base, aviso: "pago_rechazado" });
    expect(mal.subject).toContain("pago no procesado");
    expect(mal.text).toContain("no se le cobró");
  });

  it("sin link no lleva botón, y el asunto va en una línea", () => {
    const m = armarMailPedido({ ...base, aviso: "pago_recibido", pedidosUrl: null, comercio: "A\r\nBcc: x@cliente.example" });
    expect(m.html).not.toContain("Ver mis pedidos");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

describe("avisoDelCobro", () => {
  it("avisa sólo cuando cambia el pago del pedido", () => {
    expect(avisoDelCobro("pendiente", "pagado", false)).toBe("pago_recibido");
    expect(avisoDelCobro("pendiente", "fallido", false)).toBe("pago_rechazado");
    expect(avisoDelCobro("fallido", "fallido", false)).toBeNull();
    expect(avisoDelCobro("pagado", "pagado", false)).toBeNull();
    expect(avisoDelCobro("fallido", "pendiente", false)).toBeNull();
  });

  it("una reversión no se avisa", () => {
    expect(avisoDelCobro("pagado", "fallido", true)).toBeNull();
  });
});
