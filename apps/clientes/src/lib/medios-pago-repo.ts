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
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { crmListaPrecioCondiciones, crmMediosPagoShop } from "@/db/crm";
import { shopTenantId } from "./tenant";
import type { MedioPago } from "./medios-pago";

/** Lo mínimo que hace falta de una conexión o transacción de drizzle. */
type Ejecutor = Pick<ReturnType<typeof getDb>, "select">;

/** ¿El error es Postgres 42P01 (tabla inexistente) o 42501 (sin permiso)? Mira también `cause`. */
function esTablaAusenteOSinPermiso(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code;
    if (code === "42P01" || code === "42501") return true;
  }
  return false;
}

/**
 * Lista de precio online de cada medio por su condición de PAGO ÚNICO (`cuotas` NULL): slug -> uuid
 * de la lista. Es el mismo uuid que trae `idPriceList` en los precios de la vista del catálogo, así
 * que el resto del Shop resuelve "precio con este medio" como siempre (`precioDeLista`).
 *
 * Tolera que la migración 0065 del CRM no esté aplicada (tabla inexistente o sin permiso): ningún
 * medio tiene lista y rige la de referencia, que es lo correcto antes de enlazar nada.
 */
async function listasDeLosMedios(db: Ejecutor): Promise<Map<string, string>> {
  try {
    const filas = await db
      .select({ medioSlug: crmListaPrecioCondiciones.medioSlug, listaId: crmListaPrecioCondiciones.listaId })
      .from(crmListaPrecioCondiciones)
      .where(and(eq(crmListaPrecioCondiciones.tenantId, shopTenantId()), isNull(crmListaPrecioCondiciones.cuotas)));
    return new Map(filas.map((f) => [f.medioSlug, f.listaId]));
  } catch (err) {
    if (!esTablaAusenteOSinPermiso(err)) throw err;
    console.warn("[medios-pago] la migración 0065 del CRM no está aplicada; los medios usan la lista de referencia.");
    return new Map();
  }
}

/**
 * Lectura que TIRA si la tabla de medios no existe. La usa la lectura cacheada (que elige su perfil
 * de caché). `idListaPrecios` sale de las condiciones de la migración 0065 (uuid de la lista online
 * enlazada; `null` = rige la lista de referencia).
 */
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
      destacarEnCatalogo: crmMediosPagoShop.destacarEnCatalogo,
      mostrarEnFicha: crmMediosPagoShop.mostrarEnFicha,
    })
    .from(crmMediosPagoShop)
    .where(eq(crmMediosPagoShop.tenantId, shopTenantId()))
    .orderBy(asc(crmMediosPagoShop.orden), asc(crmMediosPagoShop.nombre));
  const listas = await listasDeLosMedios(db);
  return filas.map((f) => ({ ...f, idListaPrecios: listas.get(f.slug) ?? null }));
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
