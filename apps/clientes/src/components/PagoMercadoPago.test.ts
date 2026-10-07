import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { customizacionBrick, textoCuotas } from "./pago-brick";

/**
 * Test de regresión a nivel de código fuente, sin montar React.
 *
 * El `useEffect` del Payment Brick depende de
 * `[initialization, customization, onReady, onError, onSubmit, onBinChange]` y,
 * si cualquiera cambia de identidad, desmonta y recrea el brick. Con una prop
 * inline, cada re-render reinicia el formulario — y el comprador vuelve a
 * "elegir medio de pago" mientras su pago se procesa.
 *
 * Pasó DOS veces: primero con initialization/customization/onSubmit, después
 * con onReady/onError. Este test existe para que no haya una tercera.
 */

const fuente = readFileSync(
  fileURLToPath(new URL("./PagoMercadoPago.tsx", import.meta.url)),
  "utf8",
);

function bloquePayment(): string {
  const inicio = fuente.indexOf("<CardPayment");
  expect(inicio, "no se encontró <CardPayment en el componente").toBeGreaterThan(-1);
  const fin = fuente.indexOf("/>", inicio);
  return fuente.slice(inicio, fin);
}

describe("PagoMercadoPago — props del Payment Brick", () => {
  const PROPS_ESTABLES = [
    "initialization",
    "customization",
    "onReady",
    "onError",
    "onSubmit",
    "onBinChange",
  ];

  for (const prop of PROPS_ESTABLES) {
    it(`${prop} no se pasa inline (función u objeto literal)`, () => {
      const bloque = bloquePayment();
      // `prop={() => …}`, `prop={async () => …}`, `prop={function …}` o `prop={{ … }}`
      const inline = new RegExp(`${prop}=\\{\\s*(async\\s*)?(\\(|function|\\{)`);
      expect(bloque, `${prop} está inline: el brick se va a reiniciar en cada render`).not.toMatch(
        inline,
      );
    });
  }
});

/**
 * Regresión de #21: si `customization` cambia de identidad entre renders, el
 * SDK desmonta y recrea el Brick y el comprador pierde lo que cargó. Con
 * `maxCuotas` la identidad sólo puede cambiar cuando cambia el valor.
 *
 * Los tests corren en node (sin DOM): la identidad la garantiza
 * `customizacionBrick` (memo por valor) y se verifica que el componente la use
 * con deps `[maxCuotas]`.
 */
const sinTema = () => ({});

describe("customizacionBrick", () => {
  it("crédito con cuotas: exactamente esas (mínimo = máximo), sólo tarjeta de crédito", () => {
    const c = customizacionBrick("credito", 6, 1000, sinTema);
    expect(c.paymentMethods).toEqual({ types: { included: ["credit_card"] }, minInstallments: 6, maxInstallments: 6 });
  });

  it("débito: sólo tarjeta de débito y sin cuotas, aunque el pedido tenga", () => {
    expect(customizacionBrick("debito", 6, 1000, sinTema).paymentMethods).toEqual({ types: { included: ["debit_card"] } });
  });

  it("sin cuotas congeladas: sin tope (lo que ofrezca Mercado Pago)", () => {
    expect("maxInstallments" in customizacionBrick("credito", undefined, 1000, sinTema).paymentMethods).toBe(false);
  });

  it("sin título propio y el botón dice el monto", () => {
    const c = customizacionBrick("credito", 1, 245300, sinTema);
    expect(c.visual.hideFormTitle).toBe(true);
    expect(c.visual.texts.formSubmit).toMatch(/^Pagar \$\s?245\.300(,00)?$/);
  });

  it("toma los colores del tema que le pasan", () => {
    const c = customizacionBrick("credito", 3, 777, () => ({ baseColor: "#16283f" }));
    expect(c.visual.style.customVariables).toEqual({ baseColor: "#16283f" });
  });

  it("textoCuotas", () => {
    expect(textoCuotas(6)).toBe("6 cuotas sin interés");
    expect(textoCuotas(1)).toBe("En un pago");
  });

  it("misma identidad para los mismos valores (re-renders del padre)", () => {
    expect(customizacionBrick("credito", 6, 500, sinTema)).toBe(customizacionBrick("credito", 6, 500, sinTema));
  });

  it("identidad distinta si cambia la tarjeta, las cuotas o el monto", () => {
    const base = customizacionBrick("credito", 6, 500, sinTema);
    expect(customizacionBrick("debito", 6, 500, sinTema)).not.toBe(base);
    expect(customizacionBrick("credito", 3, 500, sinTema)).not.toBe(base);
    expect(customizacionBrick("credito", 6, 501, sinTema)).not.toBe(base);
  });

  it("cuotas inválidas se tratan como sin tope", () => {
    expect(customizacionBrick("credito", 0, 90, sinTema)).toBe(customizacionBrick("credito", undefined, 90, sinTema));
    expect(customizacionBrick("credito", 2.5, 90, sinTema)).toBe(customizacionBrick("credito", undefined, 90, sinTema));
  });

  it("no se congela: el SDK del Brick puede mutarla sin romper el checkout", () => {
    expect(Object.isFrozen(customizacionBrick("credito", 6, 1000, sinTema))).toBe(false);
  });
});

describe("PagoMercadoPago usa la customization estable", () => {
  it("memoiza con deps [tipoTarjeta, maxCuotas, monto] y pasa esa instancia al Brick", () => {
    expect(fuente).toMatch(
      /useMemo\(\s*\(\)\s*=>\s*customizacionBrick\(tipoTarjeta, maxCuotas, monto\) as CustomizacionSdk,\s*\[tipoTarjeta, maxCuotas, monto\]\s*,?\s*\)/,
    );
    expect(fuente).toMatch(/customization=\{customization\}/);
  });
});
