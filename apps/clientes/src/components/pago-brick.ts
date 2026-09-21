/**
 * `customization` del Payment Brick con identidad estable por valor.
 *
 * El SDK desmonta y recrea el Brick cuando cambia la identidad de
 * `customization` (regresión #21). Memoizar en el módulo, además del `useMemo`
 * del componente, garantiza la misma instancia para el mismo `maxCuotas`
 * incluso entre remontes, y permite testearlo sin DOM.
 *
 * `mercadoPago: "all"` habilita dinero en cuenta dentro del mismo Brick (ver
 * comentario en PagoMercadoPago.tsx).
 *
 * No se congela con `Object.freeze`: el objeto se lo pasamos a un SDK remoto
 * que podría mutarlo, y un TypeError ahí rompería el checkout incluso con
 * CUOTAS_ENABLED apagado. La inmutabilidad queda a nivel de tipos.
 */

export interface CustomizacionBrick {
  readonly paymentMethods: {
    readonly creditCard: "all";
    readonly debitCard: "all";
    readonly mercadoPago: "all";
    readonly maxInstallments?: number;
  };
  readonly visual: { readonly style: { readonly theme: "default" } };
}

const cache = new Map<number | "sin", CustomizacionBrick>();

export function customizacionBrick(maxCuotas: number | undefined): CustomizacionBrick {
  const valido = typeof maxCuotas === "number" && Number.isInteger(maxCuotas) && maxCuotas >= 1;
  const clave = valido ? maxCuotas : "sin";
  const previa = cache.get(clave);
  if (previa) return previa;

  const nueva: CustomizacionBrick = {
    paymentMethods: {
      creditCard: "all",
      debitCard: "all",
      mercadoPago: "all",
      ...(valido ? { maxInstallments: maxCuotas } : {}),
    },
    visual: { style: { theme: "default" } },
  };
  cache.set(clave, nueva);
  return nueva;
}
