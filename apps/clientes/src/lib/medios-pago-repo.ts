/**
 * Lectura de los medios de pago del CRM (`public.medios_pago_shop`). SOLO servidor.
 *
 * La tabla la crea una migración del CRM que puede no estar aplicada todavía: toda lectura
 * TOLERA que no exista (o que el permiso no esté concedido) y devuelve `[]`, que el checkout
 * interpreta como "sin medios cargados": el pago sale "a_coordinar". Una lista vacía
 * (tabla vacía) se trata igual, a propósito: no cargar medios todavía no puede
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

/** ¿El error es Postgres 42703 (columna inexistente)? Mira también `cause` (drizzle envuelve el error). */
function esColumnaInexistente(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "42703") return true;
  }
  return false;
}

/**
 * Lectura que TIRA si la tabla no existe. La usa la lectura cacheada (que elige su perfil de caché).
 *
 * Tolera que la migración 0061 del CRM (lista de precios, destacado y ficha) no esté aplicada: ante
 * 42703 reintenta con las columnas de siempre y devuelve `idListaPrecios: null`, destacado y ficha en
 * `false`. Así el checkout sigue ofreciendo los medios (con la lista por defecto) y no cae a
 * "a_coordinar" por un deploy adelantado a la migración.
 */
export async function leerMediosPago(db: Ejecutor = getDb()): Promise<MedioPago[]> {
  const columnasBase = {
    slug: crmMediosPagoShop.slug,
    nombre: crmMediosPagoShop.nombre,
    instrucciones: crmMediosPagoShop.instrucciones,
    activo: crmMediosPagoShop.activo,
    aplicaRetiro: crmMediosPagoShop.aplicaRetiro,
    aplicaEnvio: crmMediosPagoShop.aplicaEnvio,
    cobroOnline: crmMediosPagoShop.cobroOnline,
    orden: crmMediosPagoShop.orden,
  };
  try {
    return await db
      .select({
        ...columnasBase,
        idListaPrecios: crmMediosPagoShop.idListaPrecios,
        destacarEnCatalogo: crmMediosPagoShop.destacarEnCatalogo,
        mostrarEnFicha: crmMediosPagoShop.mostrarEnFicha,
      })
      .from(crmMediosPagoShop)
      .where(eq(crmMediosPagoShop.tenantId, shopTenantId()))
      .orderBy(asc(crmMediosPagoShop.orden), asc(crmMediosPagoShop.nombre));
  } catch (err) {
    if (!esColumnaInexistente(err)) throw err;
    console.warn("[medios-pago] la migración 0061 del CRM no está aplicada; se usa la lista por defecto.");
    const filas = await db
      .select(columnasBase)
      .from(crmMediosPagoShop)
      .where(eq(crmMediosPagoShop.tenantId, shopTenantId()))
      .orderBy(asc(crmMediosPagoShop.orden), asc(crmMediosPagoShop.nombre));
    return filas.map((f) => ({ ...f, idListaPrecios: null, destacarEnCatalogo: false, mostrarEnFicha: false }));
  }
}

/** Lo mismo, pero con la tabla ausente (o cualquier falla) devuelve `[]`: el pago sale "a_coordinar". */
export async function leerMediosPagoTolerante(db: Ejecutor = getDb()): Promise<MedioPago[]> {
  try {
    return await leerMediosPago(db);
  } catch (err) {
    console.warn(
      "[medios-pago] no se pudieron leer los medios de pago del CRM; el pago sale a_coordinar:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
