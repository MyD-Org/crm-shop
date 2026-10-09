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
 * SDK desmonta y recrea el Brick y el comprador pierde lo que cargó. Las cuotas
 * se eligen en nuestro desplegable (`SelectorCuotas`), no en el Brick: su
 * customization depende sólo del tipo de tarjeta, así que cambiar las cuotas
 * nunca la cambia.
 *
 * Los tests corren en node (sin DOM): la identidad la garantiza
 * `customizacionBrick` (memo por valor) y se verifica que el componente la use
 * con deps `[tipoTarjeta]`.
 */
const sinTema = () => ({});

describe("customizacionBrick", () => {
  // Primero: la instancia queda memoizada por tipo con las variables de la primera lectura.
  it("toma los colores del tema que le pasan", () => {
    const c = customizacionBrick("credito", () => ({ baseColor: "#16283f" }));
    expect(c.visual.style.customVariables).toEqual({ baseColor: "#16283f" });
  });

  it("crédito: un pago para el Brick (mínimo = máximo = 1, su selector queda oculto)", () => {
    const c = customizacionBrick("credito", sinTema);
    expect(c.paymentMethods).toEqual({ types: { included: ["credit_card"] }, minInstallments: 1, maxInstallments: 1 });
  });

  it("débito: sólo tarjeta de débito y sin cuotas", () => {
    expect(customizacionBrick("debito", sinTema).paymentMethods).toEqual({ types: { included: ["debit_card"] } });
  });

  it("sin título ni botón propios (el botón es un Button del DS)", () => {
    const c = customizacionBrick("credito", sinTema);
    expect(c.visual.hideFormTitle).toBe(true);
    expect(c.visual.hidePaymentButton).toBe(true);
  });

  it("misma identidad para el mismo tipo (re-renders del padre, cambio de cuotas)", () => {
    expect(customizacionBrick("credito", sinTema)).toBe(customizacionBrick("credito", sinTema));
  });

  it("identidad distinta sólo si cambia la tarjeta", () => {
    expect(customizacionBrick("debito", sinTema)).not.toBe(customizacionBrick("credito", sinTema));
  });

  it("no se congela: el SDK del Brick puede mutarla sin romper el checkout", () => {
    expect(Object.isFrozen(customizacionBrick("credito", sinTema))).toBe(false);
  });
});

describe("PagoMercadoPago: props del Brick estables", () => {
  it("memoiza la customization con deps [tipoTarjeta] y pasa esa instancia al Brick", () => {
    expect(fuente).toMatch(
      /useMemo\(\s*\(\)\s*=>\s*customizacionBrick\(tipoTarjeta\) as CustomizacionSdk,\s*\[tipoTarjeta\]\s*,?\s*\)/,
    );
    expect(fuente).toMatch(/customization=\{customization\}/);
  });

  it("el monto del Brick queda congelado: cambiar las cuotas no lo remonta (solo cambia al recotizar otra forma) ni borra la tarjeta", () => {
    expect(fuente).toMatch(/const \[montoBrick, setMontoBrick\] = useState\(monto\)/);
    expect(fuente).toMatch(/amount: montoBrick/);
  });

  it("onBinChange estable (useCallback sin dependencias) y pasado al Brick", () => {
    expect(fuente).toMatch(/const onBinChange = useCallback\([^]*?\[\]\)/);
    expect(fuente).toMatch(/onBinChange=\{onBinChange\}/);
  });

  it("mientras procesa, los campos de la tarjeta quedan bloqueados (inert), como el resto del formulario", () => {
    expect(fuente).toMatch(/inert=\{procesando\}/);
  });

  it("cobra las cuotas de nuestro desplegable, no las del Brick", () => {
    expect(fuente).not.toMatch(/cuotas:\s*datos\?\.installments/);
  });
});
