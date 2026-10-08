import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { modalidadesPaywayHabilitadas, opcionesMercadoPagoHabilitadas } from "./pago-opciones";

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
});
