import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formaDeOpcionMercadoPago,
  modalidadesPaywayHabilitadas,
  opcionDeFormaMercadoPago,
  opcionesMercadoPagoHabilitadas,
} from "./pago-opciones";

describe("opcionesMercadoPagoHabilitadas (formas de pago del admin, migración 0073 del CRM)", () => {
  it("sin dato: las tres, en el orden de la pantalla", () => {
    expect(opcionesMercadoPagoHabilitadas(undefined)).toEqual(["credito", "debito", "cuenta"]);
  });

  it("sólo débito: el formulario ofrece únicamente débito", () => {
    expect(opcionesMercadoPagoHabilitadas(["debito"])).toEqual(["debito"]);
  });

  it("sin cuenta de Mercado Pago: no aparece y las tarjetas sí", () => {
    expect(opcionesMercadoPagoHabilitadas(["credito", "debito"])).toEqual(["credito", "debito"]);
  });
});

describe("modalidadesPaywayHabilitadas", () => {
  it("sin dato: crédito y débito; sin crédito: sólo débito; la cuenta de Mercado Pago no cuenta", () => {
    expect(modalidadesPaywayHabilitadas(undefined)).toEqual(["credito", "debito"]);
    expect(modalidadesPaywayHabilitadas(["debito", "cuenta_mp"])).toEqual(["debito"]);
  });
});

describe("forma de pago de cada opción (listas por forma)", () => {
  it("la opción de Mercado Pago y su forma de pago se corresponden", () => {
    expect(formaDeOpcionMercadoPago("credito")).toBe("credito");
    expect(formaDeOpcionMercadoPago("debito")).toBe("debito");
    expect(formaDeOpcionMercadoPago("cuenta")).toBe("cuenta_mp");
    expect(opcionDeFormaMercadoPago("cuenta_mp", ["credito", "debito", "cuenta"])).toBe("cuenta");
  });

  it("la pestaña inicial es la forma del pedido si sigue habilitada; si no, null", () => {
    expect(opcionDeFormaMercadoPago("debito", ["credito", "debito"])).toBe("debito");
    expect(opcionDeFormaMercadoPago("cuenta_mp", ["credito", "debito"])).toBeNull();
    expect(opcionDeFormaMercadoPago(null, ["credito", "debito"])).toBeNull();
  });
});

/** Guardas de código fuente (el proyecto de unit tests corre en `node`, sin montar React). */
describe("los formularios y el checkout usan las formas habilitadas", () => {
  const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");

  it("Mercado Pago y Payway filtran sus opciones por lo habilitado", () => {
    expect(leer("./PagoMercadoPago.tsx")).toMatch(/const opciones = todas\.filter\(\(o\) => habilitadas\.includes/);
    expect(leer("./PagoPayway.tsx")).toMatch(/const opciones = todas\.filter\(\(o\) => habilitadas\.includes/);
  });

  it("el checkout pasa las formas del medio a los dos formularios", () => {
    const checkout = leer("./CheckoutClient.tsx");
    expect(checkout.match(/opcionesCobro=\{opcionesCobroDe\(confirmado\.procesador\)\}/g)).toHaveLength(2);
  });

  it("al cambiar de pestaña o modalidad se recotiza antes de mostrar la nueva (y las cuotas vuelven a 1 pago)", () => {
    const mp = leer("./PagoMercadoPago.tsx");
    const pw = leer("./PagoPayway.tsx");
    expect(mp).toMatch(/await cambiarFormaDelPedido\(\{ pedidoId, pagoMetodo, forma \}\)/);
    expect(mp).toMatch(/formaCobroPedido == null \|\| forma === formaCobroPedido/);
    expect(pw).toMatch(/await cambiarFormaDelPedido\(\{ pedidoId, pagoMetodo, forma: nueva \}\)/);
    expect(pw).toMatch(/formaCobroPedido == null \|\| nueva === formaCobroPedido/);
    // El cobro siempre declara la forma que se paga: sin ella el servidor volvería a la de por defecto.
    expect(mp).toMatch(/forma: formaDeOpcionMercadoPago\(opcion\)/);
    expect(pw).toMatch(/forma: modalidad,/);
  });

  it("el checkout pasa la forma congelada del pedido a los dos formularios", () => {
    const checkout = leer("./CheckoutClient.tsx");
    expect(checkout.match(/formaCobroPedido=\{confirmado\.formaCobro \?\? null\}/g)).toHaveLength(2);
  });

  it("el checkout cotiza y crea el pedido con la forma inicial del medio (el total visto = el del pedido)", () => {
    const checkout = leer("./CheckoutClient.tsx");
    expect(checkout).toContain("formaInicialDelMedio(medioSel)");
    expect(checkout.match(/\.\.\.\(formaDelMedio \? \{ forma: formaDelMedio \} : \{\}\)/g)).toHaveLength(2);
    expect(checkout).toMatch(/forma: formaDelMedio \}/);
  });
});
