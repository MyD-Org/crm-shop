import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";
import { armarMailPedido, type AvisoPedidoShop } from "./pedido-mail";
import { esPedidoDeInvitado } from "./pedido-avisos";

const base = {
  numero: "PED-00000042",
  contactoNombre: "Ana",
  comercio: "Tienda Demo",
  lineas: [{ nombre: "Lámpara", cantidad: 2 }],
  total: 12100,
  pago: "Mercado Pago",
};
const PAGAR = "https://tienda.cliente.example/pagar/VALOR_PRUEBA";
const CUENTA = "https://tienda.cliente.example/registro?email=ana%40cliente.example";

describe("armarMailPedido: invitado", () => {
  it("pago_pendiente: título, botón «Pagar su pedido» y «Cree su cuenta»; sin «Ver mis pedidos»", () => {
    const m = armarMailPedido({ ...base, aviso: "pago_pendiente", pedidosUrl: null, pagarUrl: PAGAR, cuentaUrl: CUENTA });
    expect(m.subject).toContain("pendiente de pago");
    expect(m.html).toContain("Su pedido está pendiente de pago");
    expect(m.html).toContain(`href="${PAGAR}"`);
    expect(m.html).toContain("Pagar su pedido");
    expect(m.html).toContain("Cree su cuenta");
    expect(m.html).not.toContain("Ver mis pedidos");
    expect(m.text).toContain(`Pagar su pedido: ${PAGAR}`);
    expect(m.text).toContain(`Cree su cuenta: ${CUENTA}`);
    expect(m.text).toContain("Lámpara × 2");
  });

  it("pago_rechazado: «Reintentar el pago» apunta al link de pago (checkoutUrl) y no se duplica el botón", () => {
    const m = armarMailPedido({ ...base, aviso: "pago_rechazado", pedidosUrl: null, checkoutUrl: PAGAR, pagarUrl: PAGAR, cuentaUrl: CUENTA });
    expect(m.html).toContain("Reintentar el pago");
    expect(m.html.split(`href="${PAGAR}"`).length - 1).toBe(1);
    expect(m.html).not.toContain("Pagar su pedido</a>");
  });

  it("pago_recibido de invitado: sin «Pagar su pedido», con «Cree su cuenta»", () => {
    const m = armarMailPedido({ ...base, aviso: "pago_recibido", pedidosUrl: null, cuentaUrl: CUENTA });
    expect(m.html).not.toContain("Pagar su pedido");
    expect(m.html).toContain("Cree su cuenta");
  });

  it.each(["recibido", "pago_recibido", "pago_rechazado"] as AvisoPedidoShop[])(
    "%s con cuenta (sin links de invitado) es idéntico al de siempre",
    (aviso) => {
      const normal = armarMailPedido({ ...base, aviso, pedidosUrl: "https://tienda.cliente.example/mi-cuenta/pedidos" });
      const conVacios = armarMailPedido({
        ...base,
        aviso,
        pedidosUrl: "https://tienda.cliente.example/mi-cuenta/pedidos",
        pagarUrl: null,
        cuentaUrl: null,
      });
      expect(conVacios).toEqual(normal);
      expect(normal.html).not.toContain("Cree su cuenta");
      expect(normal.html).not.toContain("Pagar su pedido");
    },
  );

  it("los textos nuevos van en usted", () => {
    const m = armarMailPedido({ ...base, aviso: "pago_pendiente", pedidosUrl: null, pagarUrl: PAGAR, cuentaUrl: CUENTA });
    expect(infracciones(m.text, REGISTRO)).toEqual([]);
  });
});

describe("esPedidoDeInvitado", () => {
  it("sólo sin cuenta: ya reclamado o con cliente vinculado es de una cuenta", () => {
    expect(esPedidoDeInvitado({ compraInvitado: true, clerkUserId: null, clienteCodigo: null })).toBe(true);
    expect(esPedidoDeInvitado({ compraInvitado: true, clerkUserId: "user_1", clienteCodigo: null })).toBe(false);
    expect(esPedidoDeInvitado({ compraInvitado: true, clerkUserId: null, clienteCodigo: "C-1" })).toBe(false);
    expect(esPedidoDeInvitado({ compraInvitado: false, clerkUserId: null, clienteCodigo: null })).toBe(false);
  });
});
