import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";
import { armarMailPedido, armarMailPedidoOperador, destinoAvisoOperador } from "./pedido-mail";
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
    expect(m.text).not.toContain("se está procesando");
  });

  it("recibido ya no lleva el párrafo del pago en proceso", () => {
    const m = armarMailPedido({ ...base, aviso: "recibido" });
    expect(m.text).not.toContain("Si ya realizó el pago");
    expect(m.text).not.toContain("Si todavía no lo completó");
  });

  it("recibido de una cuenta corriente: informa con qué medio paga, sin cobro", () => {
    const m = armarMailPedido({ ...base, aviso: "recibido", pago: "Efectivo o cheque", pagoCuentaCorriente: true });
    expect(m.text).toContain("Pagará con Efectivo o cheque.");
    expect(m.text).not.toContain("completó el pago");
    expect(m.html).toContain("Pagará con Efectivo o cheque.");
    expect(infracciones(m.text, REGISTRO)).toEqual([]);
  });

  it("recibido sin la marca de cuenta corriente no cambia", () => {
    const m = armarMailPedido({ ...base, aviso: "recibido", pago: "Efectivo o cheque" });
    expect(m.text).not.toContain("Pagará con");
  });

  it("pago recibido: confirma pedido y pago, con el detalle del pedido", () => {
    const ok = armarMailPedido({
      ...base,
      aviso: "pago_recibido",
      lineas: [{ nombre: "X", cantidad: 1 }],
      total: 100,
      entrega: "Retiro en local",
      pago: "Mercado Pago",
    });
    expect(ok.subject).toBe("Tienda <Demo> — Pedido PED-00000042 y pago recibidos");
    expect(ok.text).toContain("Recibimos su pedido y su pago");
    expect(ok.text).toContain("- X × 1");
    expect(ok.text).toContain("Pago: Mercado Pago");
    expect(ok.html).toContain("Ver mis pedidos");
  });

  it("pago recibido en cuotas con interés: el total del pedido a 1 pago y lo que pagó, informativo", () => {
    const m = armarMailPedido({
      ...base,
      aviso: "pago_recibido",
      lineas: [{ nombre: "Lámpara", cantidad: 1 }],
      total: 50000,
      pago: "Mercado Pago",
      pagado: { total: 66000, cuotas: 6 },
    });
    const t = m.text.replace(/\s/g, " ");
    expect(t).toMatch(/Total: \$ ?50\.000/);
    expect(t).toMatch(/Pagado: \$ ?66\.000(,00)? en 6 cuotas/);
    expect(m.html.replace(/\s/g, " ")).toMatch(/\$ ?66\.000(,00)? en 6 cuotas/);
    expect(infracciones(m.text, REGISTRO)).toEqual([]);
  });

  it("sin interés o en 1 pago no agrega la fila de lo pagado", () => {
    const m = armarMailPedido({ ...base, aviso: "pago_recibido", lineas: [{ nombre: "L", cantidad: 1 }], total: 54000 });
    expect(m.text).not.toContain("Pagado:");
  });

  it("pago rechazado: sin resumen, con enlace para reintentar el pago", () => {
    const mal = armarMailPedido({
      ...base,
      aviso: "pago_rechazado",
      lineas: [{ nombre: "X", cantidad: 1 }],
      checkoutUrl: "https://tienda.cliente.example/checkout",
    });
    expect(mal.subject).toContain("pago no procesado");
    expect(mal.text).toContain("no se le cobró");
    expect(mal.text).toContain("elegir otro medio de pago");
    expect(mal.text).not.toContain("- X");
    expect(mal.html).toContain('href="https://tienda.cliente.example/checkout"');
    expect(mal.html).toContain("Reintentar el pago");
    expect(mal.text).toContain("Reintentar el pago: https://tienda.cliente.example/checkout");
  });

  it("pago rechazado sin checkoutUrl cae al botón de Mis pedidos", () => {
    const mal = armarMailPedido({ ...base, aviso: "pago_rechazado" });
    expect(mal.html).not.toContain("Reintentar el pago</a>");
    expect(mal.html).toContain("Ver mis pedidos");
  });

  it("sin link no lleva botón, y el asunto va en una línea", () => {
    const m = armarMailPedido({ ...base, aviso: "pago_recibido", pedidosUrl: null, comercio: "A\r\nBcc: x@cliente.example" });
    expect(m.html).not.toContain("Ver mis pedidos");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("documento HTML completo (layout común) y pie con el comercio, el sitio y el aviso de automático", () => {
    const m = armarMailPedido({ ...base, aviso: "pago_recibido", sitioUrl: "https://tienda.cliente.example" });
    expect(m.html).toContain("<!DOCTYPE html>");
    expect(m.html).toContain('<meta charset="utf-8">');
    expect(m.html).toContain('href="https://tienda.cliente.example"');
    expect(m.html).toContain("Este es un mensaje automático.");
    expect(m.text).toContain("Tienda <Demo> · https://tienda.cliente.example");
    expect(m.text).toContain("Este es un mensaje automático.");
  });

  it("en usted: sin voseo ni tuteo", () => {
    const m = armarMailPedido({
      ...base,
      aviso: "recibido",
      lineas: [{ nombre: "Lámpara", cantidad: 1 }],
    });
    const ok = armarMailPedido({ ...base, aviso: "pago_recibido", lineas: [{ nombre: "Lámpara", cantidad: 1 }] });
    const mal = armarMailPedido({ ...base, aviso: "pago_rechazado", checkoutUrl: "https://tienda.cliente.example/checkout" });
    for (const parte of [m.subject, m.html, m.text, ok.subject, ok.html, ok.text, mal.subject, mal.html, mal.text]) {
      expect(infracciones(parte, REGISTRO)).toEqual([]);
    }
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

describe("armarMailPedido: contacto del pedido a confirmar", () => {
  const contacto = { mensaje: "Nos comunicaremos dentro de las 24 horas hábiles." };

  it("recibido: incluye el plazo, sin botón de WhatsApp", () => {
    const m = armarMailPedido({ ...base, aviso: "recibido", contacto });
    expect(m.html).toContain(contacto.mensaje);
    expect(m.text).toContain(contacto.mensaje);
    expect(m.html).not.toContain("wa.me");
    expect(m.html).not.toContain("WhatsApp");
    expect(m.text).not.toContain("WhatsApp");
  });

  it("recibido por transferencia: sin plazo de contacto (ya lleva los datos para transferir)", () => {
    const m = armarMailPedido({ ...base, aviso: "recibido", contacto, transferencia: { cuenta: null } });
    expect(m.html).not.toContain(contacto.mensaje);
  });

  it("pago recibido lleva el contacto; el rechazo no", () => {
    expect(armarMailPedido({ ...base, aviso: "pago_recibido", contacto }).html).toContain(contacto.mensaje);
    expect(armarMailPedido({ ...base, aviso: "pago_rechazado", contacto }).html).not.toContain(contacto.mensaje);
  });

  it("sin contacto (flag apagado) el mail queda como siempre", () => {
    const m = armarMailPedido({ ...base, aviso: "recibido" });
    expect(m.text).not.toContain("Nos comunicaremos");
  });
});

describe("destinoAvisoOperador", () => {
  it("prefiere el email de la sucursal", () => {
    expect(destinoAvisoOperador("local@tienda.cliente.example", "pagos@tienda.cliente.example")).toBe(
      "local@tienda.cliente.example",
    );
  });
  it("sin email de sucursal cae al de comprobantes de la empresa", () => {
    expect(destinoAvisoOperador(null, " pagos@tienda.cliente.example ")).toBe("pagos@tienda.cliente.example");
    expect(destinoAvisoOperador("no es un mail", "pagos@tienda.cliente.example")).toBe("pagos@tienda.cliente.example");
  });
  it("sin ninguno válido, null", () => {
    expect(destinoAvisoOperador("", "")).toBeNull();
    expect(destinoAvisoOperador(null, undefined)).toBeNull();
  });
});

describe("armarMailPedidoOperador", () => {
  const op = {
    numero: "PED-00000042",
    comercio: "Tienda <Demo>",
    sucursal: "Sucursal <Centro>",
    contactoNombre: "Ana <b>",
    contactoTelefono: "3757 400000",
    clienteEmail: "ana@cliente.example",
    lineas: [{ nombre: "Lámpara <LED>", cantidad: 2 }],
    total: 12100,
    entrega: "Envío a domicilio",
    pago: "Transferencia bancaria",
    pedidoUrl: "https://admin.plataforma.example/admin/pedidos/abc",
  };

  it("cambio de medio: asunto y título propios, con el medio anterior y el nuevo", () => {
    const m = armarMailPedidoOperador({ ...op, pago: "Mercado Pago", medioAnterior: "Transferencia" });
    expect(m.subject).toBe("Tienda <Demo> — Pedido PED-00000042: cambió el medio de pago");
    expect(m.html).toContain("Cambió el medio de pago");
    expect(m.text).toContain("cambió el medio de pago de Transferencia a Mercado Pago");
    expect(m.html).not.toContain("Nuevo pedido");
  });

  it("asunto, datos del comprador escapados y botón al tablero", () => {
    const m = armarMailPedidoOperador(op);
    expect(m.subject).toBe("Tienda <Demo> — Nuevo pedido PED-00000042");
    expect(m.html).toContain("Ana &lt;b&gt;");
    expect(m.html).toContain("Lámpara &lt;LED&gt;");
    expect(m.html).not.toContain("<LED>");
    expect(m.html).toContain("Sucursal &lt;Centro&gt;");
    expect(m.html).toContain('href="https://admin.plataforma.example/admin/pedidos/abc"');
    expect(m.text).toContain("- Lámpara <LED> × 2");
    expect(m.text).toContain("Teléfono: 3757 400000");
    expect(m.text).toContain("Email: ana@cliente.example");
    expect(m.text).toContain("Ver el pedido: https://admin.plataforma.example/admin/pedidos/abc");
  });

  it("sin link al tablero no lleva botón", () => {
    const m = armarMailPedidoOperador({ ...op, pedidoUrl: null });
    expect(m.html).not.toContain("Ver el pedido");
    expect(m.text).not.toContain("Ver el pedido");
  });

  it("copy en usted", () => {
    const m = armarMailPedidoOperador(op);
    expect(infracciones(m.text, REGISTRO)).toEqual([]);
  });
});
