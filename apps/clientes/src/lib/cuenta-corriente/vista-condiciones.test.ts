import { describe, expect, it } from "vitest";
import { hrefTelefono, limiteVisible, plazoAparte, textoConsulta } from "./vista-condiciones";

/** Reglas de pantalla de Condiciones, portadas de CondicionesClient del portal. */

describe("plazoAparte", () => {
  it.each([
    [{ condicionPago: "30 días", plazoDias: 30 }, null],
    [{ condicionPago: "Cuenta corriente", plazoDias: 45 }, "45 días"],
    [{ condicionPago: null, plazoDias: 15 }, "15 días"],
    [{ condicionPago: "Contado", plazoDias: 0 }, null],
    [{ condicionPago: null, plazoDias: null }, null],
  ] as const)("%o ⇒ %s", (c, esperado) => {
    expect(plazoAparte(c)).toBe(esperado);
  });
});

describe("helpers", () => {
  it("limiteVisible: sólo > 0", () => {
    expect(limiteVisible(null)).toBeNull();
    expect(limiteVisible(0)).toBeNull();
    expect(limiteVisible(1000)).toBe(1000);
  });

  it("textoConsulta en usted, con vendedor, con tienda o sin nada", () => {
    expect(textoConsulta(true, "Tienda")).toBe("Ante cualquier duda, consulte con su vendedor asignado.");
    expect(textoConsulta(false, "Tienda Uno")).toBe("Ante cualquier duda, consulte con Tienda Uno.");
    expect(textoConsulta(false, null)).toBe("Ante cualquier duda, consulte con el local.");
  });

  it("hrefTelefono deja dígitos y +", () => {
    expect(hrefTelefono("+54 11 5555-0000")).toBe("tel:+541155550000");
  });
});
