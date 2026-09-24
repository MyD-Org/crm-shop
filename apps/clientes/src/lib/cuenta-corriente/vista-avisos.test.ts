import { describe, expect, it } from "vitest";
import { describirAviso, hrefFacturaAviso, textoNoLeidos } from "./vista-avisos";

/** Textos en usted (portados del portal), tono y destinos de los avisos (AVI-1, AVI-2). */

const aviso = (type: string, facturaAlegraId: string | null = "5001") => ({ type, facturaId: "987", facturaAlegraId });

describe("describirAviso", () => {
  it.each([
    ["before_due_3", "Su factura 987 vence en 3 días", "info"],
    ["before_due_1", "Su factura 987 vence mañana", "warning"],
    ["before_due_0", "Su factura 987 vence hoy", "warning"],
    ["after_due_7", "Su factura 987 venció hace 7 días", "danger"],
    ["after_due_1", "Su factura 987 venció hace 1 día", "danger"],
  ])("%s ⇒ %s", (type, titulo, tono) => {
    const d = describirAviso(aviso(type), false);
    expect(d.titulo).toBe(titulo);
    expect(d.tono).toBe(tono);
    expect(d.destino).toEqual({ href: "/mi-cuenta/facturas?factura=987&alegra=5001", label: "Ver factura" });
  });

  it("aviso viejo sin id de Alegra: deep link sólo con el número", () => {
    expect(describirAviso(aviso("after_due_2", null), false).destino?.href).toBe("/mi-cuenta/facturas?factura=987");
  });

  it("conditions_changed: a Condiciones si es cuenta corriente, si no a Facturas y saldo", () => {
    const cc = describirAviso(aviso("conditions_changed"), true);
    expect(cc.titulo).toBe("Se actualizaron sus condiciones comerciales");
    expect(cc.destino).toEqual({ href: "/mi-cuenta/condiciones", label: "Ver condiciones" });
    expect(describirAviso(aviso("conditions_changed"), false).destino?.href).toBe("/mi-cuenta/facturas");
  });

  it("ningún destino apunta al portal del CRM", () => {
    for (const t of ["before_due_3", "after_due_7", "conditions_changed", "otro"]) {
      for (const cc of [true, false]) expect(describirAviso(aviso(t), cc).destino?.href ?? "").not.toMatch(/portal/);
    }
  });

  it("tipo desconocido: sin destino", () => {
    expect(describirAviso(aviso("payment_ok"), true).destino).toBeNull();
  });
});

describe("helpers", () => {
  it("hrefFacturaAviso codifica el número y el id", () => {
    expect(hrefFacturaAviso("A 1/2", "7&x")).toBe("/mi-cuenta/facturas?factura=A%201%2F2&alegra=7%26x");
  });

  it("textoNoLeidos en singular y plural", () => {
    expect(textoNoLeidos(1)).toBe("Tiene 1 aviso sin leer.");
    expect(textoNoLeidos(4)).toBe("Tiene 4 avisos sin leer.");
  });
});
