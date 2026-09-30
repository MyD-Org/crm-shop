/**
 * Lectura de los medios de pago del CRM (`public.medios_pago_shop`). SOLO servidor.
 *
 * La tabla la crea una migración del CRM que puede no estar aplicada todavía: toda lectura
 * TOLERA que no exista (o que el permiso no esté concedido) y devuelve `[]`, que el checkout
 * interpreta como "sin medios cargados": sigue con las opciones fijas de siempre. Una lista vacía
 * (tabla vacía) se trata igual, a propósito: prender el flag antes de cargar los medios no puede
 * dejar el paso Pago sin salida.
 *
 * Trae TODAS las filas del tenant (activas o no): el filtro por activo y por modalidad es puro
 * (`mediosParaModalidad`), y el nombre de un medio ya desactivado sigue haciendo falta para mostrar
 * pedidos viejos.
 */
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmMediosPagoShop } from "@/db/crm";
import { shopTenantId } from "./tenant";
import type { MedioPago } from "./medios-pago";

/** Lo mínimo que hace falta de una conexión o transacción de drizzle. */
type Ejecutor = Pick<ReturnType<typeof getDb>, "select">;

/** Lectura que TIRA si la tabla no existe. La usa la lectura cacheada (que elige su perfil de caché). */
export async function leerMediosPago(db: Ejecutor = getDb()): Promise<MedioPago[]> {
  const filas = await db
    .select({
      slug: crmMediosPagoShop.slug,
      nombre: crmMediosPagoShop.nombre,
      instrucciones: crmMediosPagoShop.instrucciones,
      activo: crmMediosPagoShop.activo,
      aplicaRetiro: crmMediosPagoShop.aplicaRetiro,
      aplicaEnvio: crmMediosPagoShop.aplicaEnvio,
      cobroOnline: crmMediosPagoShop.cobroOnline,
      orden: crmMediosPagoShop.orden,
    })
    .from(crmMediosPagoShop)
    .where(eq(crmMediosPagoShop.tenantId, shopTenantId()))
    .orderBy(asc(crmMediosPagoShop.orden), asc(crmMediosPagoShop.nombre));
  return filas;
}

/** Lo mismo, pero con la tabla ausente (o cualquier falla) devuelve `[]`: cae a las opciones fijas. */
export async function leerMediosPagoTolerante(db: Ejecutor = getDb()): Promise<MedioPago[]> {
  try {
    return await leerMediosPago(db);
  } catch (err) {
    console.warn(
      "[medios-pago] no se pudieron leer los medios de pago del CRM; se usan las opciones fijas:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
