/**
 * `customization` del Card Payment Brick con identidad estable por valor.
 *
 * El SDK desmonta y recrea el Brick cuando cambia la identidad de
 * `customization` (regresión #21). Memoizar en el módulo, además del `useMemo`
 * del componente, garantiza la misma instancia para los mismos valores
 * incluso entre remontes, y permite testearlo sin DOM.
 *
 * Es el formulario de UNA tarjeta (crédito o débito): la elección del medio
 * (crédito, débito, cuenta de Mercado Pago) es nuestra, con el `RadioGroup` del
 * DS, y el Brick va adentro de la opción elegida. Por eso sin título propio.
 *
 * No se congela con `Object.freeze`: el objeto se lo pasamos a un SDK remoto
 * que podría mutarlo, y un TypeError ahí rompería el checkout. La
 * inmutabilidad queda a nivel de tipos.
 */

import type { ComponentProps } from "react";
import type { CardPayment } from "@mercadopago/sdk-react";
import { fmtPrecio } from "@/lib/format";

/** Lo que espera el SDK: sus tipos son más laxos (`visual: object`) y con arrays mutables. */
export type CustomizacionSdk = ComponentProps<typeof CardPayment>["customization"];

export type TipoTarjeta = "credito" | "debito";

/** Variables de estilo del Brick (nombres del SDK), sacadas del tema de la tienda. */
export type VariablesBrick = Readonly<Record<string, string>>;

export interface CustomizacionBrick {
  readonly paymentMethods: {
    readonly types: { readonly included: ("credit_card" | "debit_card")[] };
    readonly minInstallments?: number;
    readonly maxInstallments?: number;
  };
  readonly visual: {
    readonly hideFormTitle: true;
    readonly texts: { readonly formSubmit: string };
    readonly style: { readonly theme: "default"; readonly customVariables: VariablesBrick };
  };
}

const cache = new Map<string, CustomizacionBrick>();

/** "En 6 cuotas sin interés" / "En un pago": lo que se muestra junto a "Tarjeta de crédito". */
export function textoCuotas(cuotas: number): string {
  return cuotas > 1 ? `${cuotas} cuotas sin interés` : "En un pago";
}

/**
 * Variables del Brick tomadas de los tokens del tema (`--color-*`, `--radius-*`), para que el
 * formulario de Mercado Pago use los colores y bordes de la tienda. Fuera del navegador, ninguna.
 */
export function variablesDelTema(): VariablesBrick {
  if (typeof document === "undefined") return {};
  const css = getComputedStyle(document.documentElement);
  const token = (n: string) => css.getPropertyValue(n).trim();
  const pares: [string, string][] = [
    ["baseColor", token("--color-primary")],
    ["buttonTextColor", token("--color-on-primary")],
    ["textPrimaryColor", token("--color-text")],
    ["textSecondaryColor", token("--color-muted")],
    ["formBackgroundColor", token("--color-surface")],
    ["inputBackgroundColor", token("--color-surface")],
    ["errorColor", token("--color-danger")],
    ["successColor", token("--color-success")],
    ["outlinePrimaryColor", token("--color-ring")],
    ["borderRadiusSmall", token("--radius-sm")],
    ["borderRadiusMedium", token("--radius-sm")],
    ["borderRadiusLarge", token("--radius")],
  ];
  return Object.fromEntries([...pares.filter(([, v]) => v !== ""), ["formPadding", "0px"]]);
}

/**
 * Con cuotas congeladas en el pedido, la tarjeta de crédito ofrece exactamente esas (mínimo = máximo):
 * el comprador ya las eligió en la tienda y el precio las incluye. El selector aparece al cargar el
 * número de tarjeta, porque Mercado Pago necesita saber qué tarjeta es. El débito es siempre un pago.
 */
export function customizacionBrick(
  tipo: TipoTarjeta,
  maxCuotas: number | undefined,
  monto: number,
  leerVariables: () => VariablesBrick = variablesDelTema,
): CustomizacionBrick {
  const valido = tipo === "credito" && typeof maxCuotas === "number" && Number.isInteger(maxCuotas) && maxCuotas >= 1;
  const clave = `${tipo}|${valido ? maxCuotas : "sin"}|${monto}`;
  const previa = cache.get(clave);
  if (previa) return previa;

  const nueva: CustomizacionBrick = {
    paymentMethods: {
      types: { included: [tipo === "credito" ? "credit_card" : "debit_card"] },
      ...(valido ? { minInstallments: maxCuotas, maxInstallments: maxCuotas } : {}),
    },
    visual: {
      hideFormTitle: true,
      texts: { formSubmit: `Pagar ${fmtPrecio(monto)}` },
      style: { theme: "default", customVariables: leerVariables() },
    },
  };
  cache.set(clave, nueva);
  return nueva;
}
