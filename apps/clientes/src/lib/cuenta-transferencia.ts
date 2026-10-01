/**
 * Vista previa de la cuenta de la transferencia para el checkout (`/api/carrito/cotizar`).
 * Puro: recibe las cuentas y las reglas de sucursales ya leídas (cacheadas, para mostrar) y
 * devuelve el mismo snapshot que `crearPedido` congelaría. La decisión que escribe un pedido
 * NUNCA pasa por acá: `crearPedido` relee todo sin caché.
 *
 * La sucursal se decide como en el pedido (`decidirSucursalDePedido`) pero SIN líneas (no hace
 * falta stock para elegir cuenta). Cualquier error de asignación (local que no admite retiro,
 * provincia sin envío) deja la sucursal en `null`: la vista previa no frena nada, sólo muestra
 * la cuenta de "todas las sucursales" o la predeterminada, y el pedido real validará.
 */
import {
  armarSnapshotCuenta,
  resolverCuenta,
  type CuentaBancaria,
  type CuentaPagoSnapshot,
} from "./cuentas-bancarias";
import type { EntradaAsignacion } from "./sucursales";
import { decidirSucursalDePedido, SucursalPedidoError } from "./sucursales-pedido";
import type { DatosSucursales } from "./sucursales-repo";

export function cuentaParaVistaPrevia(p: {
  cuentas: readonly CuentaBancaria[];
  datos: DatosSucursales;
  entrada: EntradaAsignacion;
  total: number;
  /** Flag `sucursales`: apagado = sin sucursal. */
  sucursalesActivas: boolean;
}): CuentaPagoSnapshot | null {
  let sucursal: string | null = null;
  if (p.sucursalesActivas) {
    try {
      sucursal = decidirSucursalDePedido(p.entrada, p.datos)?.sucursal ?? null;
    } catch (err) {
      if (!(err instanceof SucursalPedidoError)) throw err;
      sucursal = null;
    }
  }
  const entrada = { sucursal, total: p.total };
  const resuelta = resolverCuenta(p.cuentas, entrada);
  return resuelta ? armarSnapshotCuenta(resuelta, entrada) : null;
}
