/**
 * Datos de las cuentas de cobro que salen del CRM (`public.sucursales`) y la cuenta prevista de cada
 * pedido. SOLO servidor.
 *
 * Las candidatas salen de los slugs de las sucursales del tenant (explícito y auditable), no de escanear
 * el entorno: el mapeo inverso `_` -> `-` de las variables sería ambiguo.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmSucursales } from "@/db/crm";
import { shopTenantId } from "@/lib/tenant";
import { cuentaConfigurada } from "./credenciales";
import { cuentaDeCobro, elegirCuenta, slugAVariable, type CuentaElegida } from "./cuenta-cobro";
import { proveedorPago } from "./index";
import type { ProveedorPago } from "./tipos";

export interface DatosCuentas {
  /** Slug de la sucursal predeterminada del tenant (cuenta de los pedidos sin sucursal), o null. */
  predeterminada: string | null;
  /** Slugs de todas las sucursales del tenant, en orden estable (predeterminada primero, luego slug). */
  slugs: string[];
}

/** Lo mínimo que hace falta de una conexión de drizzle. */
type Ejecutor = Pick<ReturnType<typeof getDb>, "select">;

/** Lectura SIN memo. La usa también el footer (`'use cache'`), que ya cachea por su cuenta. */
export async function leerDatosCuentas(db: Ejecutor = getDb()): Promise<DatosCuentas> {
  const filas = await db
    .select({ slug: crmSucursales.slug, activa: crmSucursales.activa, predeterminada: crmSucursales.predeterminada })
    .from(crmSucursales)
    .where(eq(crmSucursales.tenantId, shopTenantId()));
  // Una predeterminada activa antes que una inactiva (el CRM mantiene una sola, pero no se confía).
  const pred =
    filas.find((f) => f.predeterminada && f.activa)?.slug ?? filas.find((f) => f.predeterminada)?.slug ?? null;
  const slugs = [...new Set(filas.map((f) => f.slug))].sort((a, b) =>
    a === pred ? -1 : b === pred ? 1 : a.localeCompare(b),
  );

  // Dos slugs con el mismo sufijo de variables cobrarían con la misma cuenta: sólo se avisa.
  const vistos = new Map<string, string>();
  for (const s of slugs) {
    const v = slugAVariable(s);
    const otro = vistos.get(v);
    if (otro) console.error(`[pagos] las sucursales ${otro} y ${s} comparten el sufijo de variables _${v}`);
    else vistos.set(v, s);
  }
  return { predeterminada: pred, slugs };
}

/**
 * Memo en memoria por instancia: el cobro no puede usar un mapeo de días (`'use cache'`), pero el dato
 * casi no cambia. Un cambio de predeterminada tarda hasta esto en verse en cada instancia.
 */
export const MEMO_CUENTAS_MS = 60_000;
let memo: { vence: number; datos: Promise<DatosCuentas> } | null = null;

export function datosCuentas(ahora = Date.now()): Promise<DatosCuentas> {
  if (memo && memo.vence > ahora) return memo.datos;
  const datos = leerDatosCuentas();
  const entrada = { vence: ahora + MEMO_CUENTAS_MS, datos };
  memo = entrada;
  // Una lectura fallida no queda memorizada: la próxima llamada vuelve a intentar.
  datos.catch(() => {
    if (memo === entrada) memo = null;
  });
  return datos;
}

/** Para tests. */
export function limpiarMemoCuentas(): void {
  memo = null;
}

/** Lo que hace falta del pedido para saber su cuenta (los dos campos son inmutables tras crearlo). */
export interface PedidoConCuenta {
  /** `orders.sucursal`: la que despacha, o el local del retiro. */
  sucursal?: string | null;
  /** `orders.sucursal_regla.facturaSucursal`: la que factura si la zona lo fuerza. */
  facturaSucursal?: string | null;
}

/** Cuenta prevista del pedido: `facturaSucursal ?? sucursal ?? predeterminada` (null = ninguna). */
export async function cuentaPrevistaDelPedido(p: PedidoConCuenta): Promise<string | null> {
  const sucursal = p.sucursal ?? null;
  const facturaSucursal = p.facturaSucursal ?? null;
  // Sin leer la base cuando el pedido ya define la cuenta.
  if (facturaSucursal || sucursal) return cuentaDeCobro({ sucursal, facturaSucursal }, null);
  return cuentaDeCobro({ sucursal, facturaSucursal }, (await datosCuentas()).predeterminada);
}

/**
 * Cuenta con la que se cobra el pedido. En esta rebanada SÓLO la prevista: si no está configurada, el
 * medio falla cerrado (el fallback a otra cuenta configurada y la evidencia de rechazo llegan con la
 * persistencia de la cuenta en el intento). `declarada` es la que dice el navegador que usó.
 */
export async function cuentaParaCobrar(
  procesadorId: string,
  pedido: PedidoConCuenta,
  declarada?: string | null,
): Promise<CuentaElegida> {
  const prevista = await cuentaPrevistaDelPedido(pedido);
  const candidatas = prevista
    ? [{ cuenta: prevista, configurada: cuentaConfigurada(procesadorId, prevista), rechazada: false }]
    : [];
  return elegirCuenta({ prevista, candidatas, declarada });
}

/**
 * Proveedor ligado a la cuenta de un intento ya abierto. Sin columna de cuenta en el intento todavía, se
 * deriva del pedido (inmutable en sucursal y regla), que es la misma con la que se reservó.
 */
export async function proveedorDeIntento(
  intento: { proveedor: string } & PedidoConCuenta,
): Promise<ProveedorPago | null> {
  const cuenta = await cuentaPrevistaDelPedido(intento);
  return cuenta ? proveedorPago(intento.proveedor, cuenta) : null;
}
