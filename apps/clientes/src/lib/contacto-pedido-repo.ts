/**
 * Datos para armar el bloque de contacto de un pedido "a confirmar" (`contacto-pedido.ts`). SOLO
 * servidor. Todo se lee sin caché (es una fila y dos consultas chicas por pedido) y NUNCA tira: sin
 * datos, el bloque sale con los defaults (24 horas hábiles, texto genérico, sin WhatsApp).
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmReglasVenta, crmSucursales } from "@/db/crm";
import { orders } from "@/db/schema";
import { shopTenantId } from "./tenant";
import { armarContactoPedido, type ContactoPedidoVista } from "./contacto-pedido";
import { REGLAS_VENTA_DEFAULT, leerReglasVenta } from "./sucursales-repo";

/**
 * `reglas_venta.mensaje_confirmacion`. Columna nueva del CRM que puede no estar migrada todavía:
 * va en su propia consulta (sumarla al select de `leerReglasVenta` rompería las reglas enteras, y
 * con ellas `crearPedido`). Ausente o vacía = "" (texto por defecto).
 */
export async function leerMensajeConfirmacion(): Promise<string> {
  try {
    const [fila] = await getDb()
      .select({ mensaje: crmReglasVenta.mensajeConfirmacion })
      .from(crmReglasVenta)
      .where(eq(crmReglasVenta.tenantId, shopTenantId()))
      .limit(1);
    return fila?.mensaje ?? "";
  } catch (err) {
    console.warn(
      "[contacto-pedido] no se pudo leer el mensaje de confirmación; se usa el texto por defecto:",
      err instanceof Error ? err.message : err,
    );
    return "";
  }
}

/** `sucursales.whatsapp` de la sucursal (slug) o null si no hay sucursal, no existe o falla la lectura. */
export async function leerWhatsappSucursal(
  slug: string | null | undefined,
): Promise<string | null> {
  if (!slug) return null;
  try {
    const [fila] = await getDb()
      .select({ whatsapp: crmSucursales.whatsapp })
      .from(crmSucursales)
      .where(and(eq(crmSucursales.tenantId, shopTenantId()), eq(crmSucursales.slug, slug)))
      .limit(1);
    return fila?.whatsapp?.trim() || null;
  } catch (err) {
    console.error("[contacto-pedido] no se pudo leer el WhatsApp de la sucursal:", err);
    return null;
  }
}

async function horasHabiles(): Promise<number> {
  try {
    return (await leerReglasVenta()).contactoHorasHabiles;
  } catch (err) {
    console.error("[contacto-pedido] no se pudieron leer las reglas de venta:", err);
    return REGLAS_VENTA_DEFAULT.contactoHorasHabiles;
  }
}

/** El bloque de contacto para una sucursal (slug o null) y un número de pedido ("PED-…"). */
export async function contactoDeSucursal(
  sucursal: string | null | undefined,
  numeroPedido?: string,
): Promise<ContactoPedidoVista> {
  const [horas, whatsapp, mensaje] = await Promise.all([
    horasHabiles(),
    leerWhatsappSucursal(sucursal),
    leerMensajeConfirmacion(),
  ]);
  return armarContactoPedido({
    horasHabiles: horas,
    whatsapp,
    mensajeConfirmacion: mensaje,
    numeroPedido,
  });
}

/** Lo mismo a partir del id de un pedido del Shop (lee `orders.sucursal`). null si el pedido no existe. */
export async function contactoDelPedido(
  pedidoId: string,
  numeroPedido?: string,
): Promise<ContactoPedidoVista | null> {
  try {
    const [fila] = await getDb()
      .select({ sucursal: orders.sucursal })
      .from(orders)
      .where(and(eq(orders.id, pedidoId), eq(orders.tenantId, shopTenantId())))
      .limit(1);
    if (!fila) return null;
    return await contactoDeSucursal(fila.sucursal, numeroPedido);
  } catch (err) {
    console.error("[contacto-pedido] no se pudo armar el contacto del pedido:", err);
    return null;
  }
}
