import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { customizacionBrick } from "./pago-brick";

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
  const inicio = fuente.indexOf("<Payment");
  expect(inicio, "no se encontró <Payment en el componente").toBeGreaterThan(-1);
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
describe("customizacionBrick", () => {
  it("con maxCuotas=3 → paymentMethods.maxInstallments === 3", () => {
    expect(customizacionBrick(3).paymentMethods.maxInstallments).toBe(3);
  });

  it("sin maxCuotas → no existe la clave (Brick como hoy)", () => {
    const c = customizacionBrick(undefined);
    expect("maxInstallments" in c.paymentMethods).toBe(false);
    expect(c).toEqual({
      paymentMethods: { creditCard: "all", debitCard: "all", mercadoPago: "all" },
      visual: { style: { theme: "default" } },
    });
  });

  it("misma identidad para el mismo maxCuotas (re-renders del padre)", () => {
    expect(customizacionBrick(6)).toBe(customizacionBrick(6));
    expect(customizacionBrick(undefined)).toBe(customizacionBrick(undefined));
  });

  it("identidad distinta si cambia el valor", () => {
    expect(customizacionBrick(6)).not.toBe(customizacionBrick(3));
    expect(customizacionBrick(6)).not.toBe(customizacionBrick(undefined));
  });

  it("valores inválidos se tratan como sin máximo", () => {
    expect(customizacionBrick(0)).toBe(customizacionBrick(undefined));
    expect(customizacionBrick(2.5)).toBe(customizacionBrick(undefined));
  });

  it("no se congela: el SDK del Brick puede mutarla sin romper el checkout", () => {
    expect(Object.isFrozen(customizacionBrick(6))).toBe(false);
    expect(Object.isFrozen(customizacionBrick(undefined).paymentMethods)).toBe(false);
  });
});

describe("PagoMercadoPago usa la customization estable", () => {
  it("memoiza con deps [maxCuotas] y pasa esa instancia al Brick", () => {
    expect(fuente).toMatch(/useMemo\(\s*\(\)\s*=>\s*customizacionBrick\(maxCuotas\),\s*\[maxCuotas\]\s*\)/);
    expect(fuente).toMatch(/customization=\{customization\}/);
  });
});
