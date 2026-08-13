/**
 * Simulación de disponibilidad para poder recorrer la tienda sin acceso a Alegra.
 *
 * Existe por una razón concreta: hoy los 2818 ítems activos de la cuenta tienen
 * `availableQuantity: 0` —verificado en vivo contra Alegra, no es el espejo— así
 * que el flujo de compra no se puede probar ni una vez.
 *
 * Solo falsea la DISPONIBILIDAD. Precios, IVA, nombres y listas siguen saliendo
 * de Alegra: un mock del catálogo entero probaría un flujo que no es el que
 * corre en producción, que es justo lo que no sirve.
 *
 * Vive en su propio módulo, sin dependencias, porque lo necesitan tanto el
 * catálogo (que lee del espejo) como la cotización (que lee de Alegra en vivo).
 * Si estuviera en cualquiera de los dos, el otro arrastraría ese módulo entero.
 *
 * Doble llave, y las dos son necesarias:
 *  1. `VERCEL_ENV !== "production"` — no alcanza con acordarse de borrar la
 *     variable de entorno; olvidarla cargada no puede hacer que el shop venda
 *     lo que no tiene. Se usa `VERCEL_ENV` y no `NODE_ENV` porque en Vercel
 *     Preview `NODE_ENV === "production"` (build de release), y sin poder
 *     activar el mock en Preview no se puede probar el checkout deployado
 *     mientras Alegra siga sin inventario cargado. `VERCEL_ENV` distingue
 *     "production" de "preview" y "development". En local es undefined, que
 *     también pasa este check.
 *  2. `SHOP_STOCK_SIMULADO === "1"` — explícita, nadie la activa sin querer.
 *
 * La primera llave se puede SALTAR con un opt-in explícito adicional:
 *  3. `SHOP_STOCK_SIMULADO_EN_PRODUCCION === "1"` — solo se usa mientras el
 *     sitio no está abierto al público y no hay inventario cargado en Alegra.
 *     Es DOBLEMENTE explícita a propósito: hay que cargar dos variables con
 *     nombres largos y distintos para que el mock funcione en producción, y
 *     una de esas dos dice literalmente "EN_PRODUCCION" en el nombre. El
 *     objetivo es que sea imposible activar esto sin darse cuenta, y que
 *     desactivarlo el día del lanzamiento sea un solo `vercel env rm`.
 *
 * Esto NO resuelve el problema de fondo: que el shop no pueda vender porque
 * Alegra no tiene inventario cargado sigue siendo una decisión del negocio.
 */
export function stockSimulado(): boolean {
  if (process.env.SHOP_STOCK_SIMULADO !== "1") return false;
  if (process.env.VERCEL_ENV !== "production") return true;
  return process.env.SHOP_STOCK_SIMULADO_EN_PRODUCCION === "1";
}
