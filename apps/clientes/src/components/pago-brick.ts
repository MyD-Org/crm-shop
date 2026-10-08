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
 * DS, y el Brick va adentro de la opción elegida. Por eso sin título propio y sin
 * su botón: "Pagar $ X" es un `Button` del DS que pide los datos con
 * `cardPaymentBrickController.getFormData()` (ver PagoMercadoPago.tsx).
 *
 * No se congela con `Object.freeze`: el objeto se lo pasamos a un SDK remoto
 * que podría mutarlo, y un TypeError ahí rompería el checkout. La
 * inmutabilidad queda a nivel de tipos.
 */

import type { ComponentProps } from "react";
import type { CardPayment } from "@mercadopago/sdk-react";

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
    readonly hidePaymentButton: true;
    readonly style: { readonly theme: "default"; readonly customVariables: VariablesBrick };
  };
}

const cache = new Map<string, CustomizacionBrick>();

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
    ["baseColorFirstVariant", token("--color-primary-hover")],
    ["buttonTextColor", token("--color-on-primary")],
    ["textPrimaryColor", token("--color-text")],
    // Placeholders de nombre y documento. Los de número, vencimiento y código viven en los campos seguros
    // de Mercado Pago (iframes) y no se pueden cambiar: con otro gris acá quedaban de dos tonos distintos.
    ["textSecondaryColor", token("--color-muted")],
    ["formBackgroundColor", token("--color-surface")],
    ["inputBackgroundColor", token("--color-surface")],
    ["errorColor", token("--color-danger")],
    ["successColor", token("--color-success")],
    // Borde de los campos: el gris de los Input del DS (con el color de marca quedaban todos azules).
    ["outlinePrimaryColor", token("--color-border-strong")],
    ["outlineSecondaryColor", token("--color-border")],
    ["borderRadiusSmall", token("--radius-sm")],
    ["borderRadiusMedium", token("--radius-sm")],
    ["borderRadiusLarge", token("--radius-sm")],
  ];
  return Object.fromEntries([...pares.filter(([, v]) => v !== ""), ["formPadding", "0px"]]);
}

/**
 * Las cuotas se eligen en nuestro desplegable (`SelectorCuotas`, con sus totales y el chip "Sin
 * interés"), no en el Brick: en crédito el Brick va en un pago (mínimo = máximo = 1), así su selector
 * queda oculto y cambiar de cuotas no le cambia las props. El servidor cobra las cuotas que mandamos
 * nosotros sobre el total del pedido. El débito es siempre un pago.
 */
export function customizacionBrick(tipo: TipoTarjeta, leerVariables: () => VariablesBrick = variablesDelTema): CustomizacionBrick {
  const previa = cache.get(tipo);
  if (previa) return previa;

  const nueva: CustomizacionBrick = {
    paymentMethods: {
      types: { included: [tipo === "credito" ? "credit_card" : "debit_card"] },
      ...(tipo === "credito" ? { minInstallments: 1, maxInstallments: 1 } : {}),
    },
    visual: {
      hideFormTitle: true,
      hidePaymentButton: true,
      style: { theme: "default", customVariables: leerVariables() },
    },
  };
  cache.set(tipo, nueva);
  return nueva;
}
