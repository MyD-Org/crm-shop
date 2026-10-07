/**
 * `customization` del Payment Brick con identidad estable por valor.
 *
 * El SDK desmonta y recrea el Brick cuando cambia la identidad de
 * `customization` (regresión #21). Memoizar en el módulo, además del `useMemo`
 * del componente, garantiza la misma instancia para el mismo `maxCuotas`
 * incluso entre remontes, y permite testearlo sin DOM.
 *
 * Sólo tarjetas: la cuenta de Mercado Pago va fuera del Brick, con su propio
 * botón "Ir a Mercado Pago" (el Brick no deja cambiar el texto del botón según
 * la opción elegida ni avisar que se sale del sitio). Así tampoco aparece
 * "Crédito de Mercado Pago".
 *
 * No se congela con `Object.freeze`: el objeto se lo pasamos a un SDK remoto
 * que podría mutarlo, y un TypeError ahí rompería el checkout incluso con
 * flag `cuotas` apagado. La inmutabilidad queda a nivel de tipos.
 */

import type { ComponentProps } from "react";
import type { Payment } from "@mercadopago/sdk-react";

/**
 * Lo que espera el SDK. Sus tipos no traen `visual.texts.paymentMethods`, aunque la documentación del
 * Payment Brick sí lo admite ("Cambiar textos"): por eso el componente convierte con este tipo.
 */
export type CustomizacionSdk = ComponentProps<typeof Payment>["customization"];

export interface CustomizacionBrick {
  readonly paymentMethods: {
    readonly creditCard: "all";
    readonly debitCard: "all";
    readonly minInstallments?: number;
    readonly maxInstallments?: number;
  };
  readonly visual: {
    readonly style: { readonly theme: "default" };
    readonly texts?: { readonly paymentMethods: { readonly creditCardValueProp: string } };
  };
}

const cache = new Map<string, CustomizacionBrick>();

/** Lo que dice la tarjeta de crédito debajo del título, en vez de "Cuotas disponibles". */
export function textoCuotas(cuotas: number): string {
  return cuotas === 1 ? "En un pago" : `En ${cuotas} cuotas`;
}

/**
 * Con cuotas congeladas en el pedido, el Brick ofrece exactamente esas (mínimo = máximo): el comprador
 * ya las eligió en la tienda y el precio las incluye. El selector aparece al cargar el número de
 * tarjeta, porque Mercado Pago necesita saber qué tarjeta es.
 */
export function customizacionBrick(maxCuotas: number | undefined): CustomizacionBrick {
  const valido = typeof maxCuotas === "number" && Number.isInteger(maxCuotas) && maxCuotas >= 1;
  const clave = valido ? String(maxCuotas) : "sin";
  const previa = cache.get(clave);
  if (previa) return previa;

  const nueva: CustomizacionBrick = {
    paymentMethods: {
      creditCard: "all",
      debitCard: "all",
      ...(valido ? { minInstallments: maxCuotas, maxInstallments: maxCuotas } : {}),
    },
    visual: {
      style: { theme: "default" },
      ...(valido ? { texts: { paymentMethods: { creditCardValueProp: textoCuotas(maxCuotas) } } } : {}),
    },
  };
  cache.set(clave, nueva);
  return nueva;
}
