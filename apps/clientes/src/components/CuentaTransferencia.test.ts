import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CuentaPagoSnapshot } from "@/lib/cuentas-bancarias";
import { CuentaTransferencia, TEXTO_SIN_CUENTA, importeParaCopiar } from "./CuentaTransferencia";

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const cuenta: CuentaPagoSnapshot = {
  v: 1,
  cuentaId: "c1",
  alias: "tienda.ejemplo",
  cbu: "0000000000000000000000",
  banco: "Banco Ejemplo",
  titular: "Titular Ejemplo SA",
  cuit: "30000000000",
  motivo: "regla",
  sucursal: "mdp",
  totalEvaluado: 121000,
  congeladaEn: "2026-10-01T12:00:00.000Z",
};

describe("CuentaTransferencia", () => {
  it("muestra alias, CBU, banco, titular, CUIT e importe, con Copiar", () => {
    const t = texto(renderToStaticMarkup(createElement(CuentaTransferencia, { cuenta, importe: 121000 })));
    expect(t).toContain("tienda.ejemplo");
    expect(t).toContain("0000000000000000000000");
    expect(t).toContain("Banco Ejemplo");
    expect(t).toContain("Titular Ejemplo SA");
    expect(t).toContain("30000000000");
    expect(t).toContain("Importe $ 121.000,00");
    expect(t).toContain("Copiar");
    expect(t).not.toContain(TEXTO_SIN_CUENTA);
  });

  it("el importe va primero (destacado)", () => {
    const t = texto(renderToStaticMarkup(createElement(CuentaTransferencia, { cuenta, importe: 121000 })));
    expect(t.indexOf("Importe")).toBeLessThan(t.indexOf("Alias"));
  });

  it("sin importe no muestra la fila del importe", () => {
    const t = texto(renderToStaticMarkup(createElement(CuentaTransferencia, { cuenta })));
    expect(t).not.toContain("Importe");
  });

  it("omite los datos vacíos (banco, titular o CUIT sin cargar)", () => {
    const t = texto(
      renderToStaticMarkup(createElement(CuentaTransferencia, { cuenta: { ...cuenta, banco: "", titular: "", cuit: "" } })),
    );
    expect(t).not.toContain("Banco");
    expect(t).not.toContain("Titular");
    expect(t).not.toContain("CUIT");
    expect(t).toContain("tienda.ejemplo");
  });

  it("sin cuenta (null): mensaje neutro, sin datos bancarios", () => {
    const t = texto(renderToStaticMarkup(createElement(CuentaTransferencia, { cuenta: null })));
    expect(t).toBe("Le enviaremos los datos para transferir");
    expect(t).not.toContain("CBU");
  });
});

describe("importeParaCopiar", () => {
  it("sin $ ni puntos de miles, con coma decimal sólo si hay centavos", () => {
    expect(importeParaCopiar(215000)).toBe("215000");
    expect(importeParaCopiar(1500.5)).toBe("1500,50");
  });
});
