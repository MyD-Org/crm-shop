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
      pagoPendienteEnLinea: true,
    });
    for (const parte of [m.subject, m.html, m.text]) {
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
  const contacto = {
    mensaje: "Nos comunicaremos dentro de las 24 horas hábiles.",
    whatsappVisible: "+54 9 11 5555-0100",
    whatsappUrl: "https://wa.me/5491155550100?text=Hola",
  };

  it("recibido: incluye el plazo y el enlace de WhatsApp (escapados), sin mostrar el número", () => {
    const m = armarMailPedido({ ...base, aviso: "recibido", contacto });
    expect(m.html).toContain("Nos comunicaremos dentro de las 24 horas hábiles.");
    expect(m.html).toContain('href="https://wa.me/5491155550100?text=Hola"');
    expect(m.html).toContain("Escribir por WhatsApp");
    expect(m.html).not.toContain("+54 9 11 5555-0100");
    expect(m.text).toContain("Nos comunicaremos dentro de las 24 horas hábiles.");
    expect(m.text).toContain("Escríbanos por WhatsApp: https://wa.me/5491155550100?text=Hola");
  });

  it("sin WhatsApp: sólo el plazo, sin enlace", () => {
    const m = armarMailPedido({ ...base, aviso: "recibido", contacto: { mensaje: contacto.mensaje } });
    expect(m.text).toContain(contacto.mensaje);
    expect(m.html).not.toContain("wa.me");
    expect(m.text).not.toContain("WhatsApp");
  });

  it("los avisos de pago no llevan el bloque de contacto", () => {
    const m = armarMailPedido({ ...base, aviso: "pago_recibido", contacto });
    expect(m.html).not.toContain("wa.me");
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
