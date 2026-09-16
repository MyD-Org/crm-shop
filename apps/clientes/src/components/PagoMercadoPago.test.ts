import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
