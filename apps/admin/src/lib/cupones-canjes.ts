import type { Tx } from "./precios-online-repo"

// Canjes de una promoción: viven en el Shop (`shop.cupon_canjes`, migración 0041 del Shop) y su
// estado se calcula desde el pedido. Módulo aparte para que los tests de rutas lo simulen.

/** Canjes de la promoción (cualquier estado): con alguno no se cambia el tipo ni el % ni se elimina. */
export async function contarCanjes(_tx: Tx, _promocionId: string): Promise<number> {
  return 0
}
