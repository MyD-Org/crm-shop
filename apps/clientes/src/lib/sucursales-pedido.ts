/**
 * Decisión de sucursal al crear un pedido (rebanada A). Puro: recibe las reglas frescas (leídas
 * SIN caché dentro de la transacción de `crearPedido`) y devuelve lo que se congela en el pedido.
 *
 * - Sin sucursales cargadas, o ninguna activa: `null` (el pedido queda con la sucursal en NULL y
 *   NO falla: una configuración a medias no frena una venta). Con ninguna activa se avisa en el log.
 * - Retiro/envío que las reglas no admiten: `SucursalPedidoError` (la ruta responde en usted).
 */
import {
  asignarSucursal,
  resolverZona,
  type Asignacion,
  type EntradaAsignacion,
} from "./sucursales";
import type { DatosSucursales } from "./sucursales-repo";

export class SucursalPedidoError extends Error {
  constructor(
    readonly codigo: "sin_retiro" | "sin_envio",
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "SucursalPedidoError";
  }
}

export const MENSAJE_SIN_RETIRO =
  "La sucursal seleccionada no admite retiro. Seleccione otro local de retiro.";
export const MENSAJE_SIN_ENVIO =
  "El envío a domicilio no está disponible para la provincia o la ciudad indicada. Seleccione retiro en el local.";

export function decidirSucursalDePedido(
  entrada: EntradaAsignacion,
  datos: DatosSucursales,
): Asignacion | null {
  if (datos.sucursales.length === 0) return null;
  const r = asignarSucursal(conLocalDeRetiro(entrada, datos), datos);
  if (!("error" in r)) return r;
  if (r.error === "sin_sucursal_activa") {
    // Decisión de negocio: una configuración a medias (sucursales cargadas pero todas inactivas) NO
    // frena ventas. El pedido queda con la sucursal en NULL y se avisa en el log para corregirlo.
    console.error(
      "[sucursales] hay sucursales cargadas pero ninguna activa: el pedido queda sin sucursal",
    );
    return null;
  }
  if (r.error === "sin_retiro")
    throw new SucursalPedidoError("sin_retiro", MENSAJE_SIN_RETIRO);
  throw new SucursalPedidoError("sin_envio", MENSAJE_SIN_ENVIO);
}

/**
 * Retiro sin local elegido (el checkout todavía no ofrece el selector): se usa la sucursal de la
 * zona del visitante si admite retiro; si no, la predeterminada; si tampoco, la primera activa que
 * admita retiro por `orden`. Un local elegido explícitamente NUNCA se reemplaza: si no admite
 * retiro, `asignarSucursal` lo rechaza.
 */
function conLocalDeRetiro(
  entrada: EntradaAsignacion,
  datos: DatosSucursales,
): EntradaAsignacion {
  if (entrada.entregaTipo !== "retiro" || entrada.sucursalRetiro)
    return entrada;
  const admiten = datos.sucursales
    .filter((s) => s.activa && s.aceptaRetiro)
    .sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug));
  const zona = resolverZona(entrada.provincia, datos.zonas, datos.sucursales);
  const deLaZona =
    "error" in zona ? undefined : admiten.find((s) => s.slug === zona.sucursal);
  const local = deLaZona ?? admiten.find((s) => s.predeterminada) ?? admiten[0];
  return local ? { ...entrada, sucursalRetiro: local.slug } : entrada;
}
