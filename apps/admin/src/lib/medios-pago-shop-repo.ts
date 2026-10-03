import { and, asc, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { mediosPagoShop } from "@/db/schema"
import { listasDeLaPrincipal } from "@/lib/catalogo-union-repo"
import { avisosDeMedio } from "@/lib/medios-pago-shop-avisos"
import {
  MSG_SIN_ENTREGA,
  SLUG_MERCADOPAGO,
  resolverListaDelMedio,
  validarMedioPagoCambios,
  validarMedioPagoNuevo,
  type CambiosMedioPago,
} from "@/lib/medios-pago-shop-validacion"

// Acceso a datos de los medios de pago del checkout (change `sucursales-igz-mdp`, rebanada C).
// TODO filtra por `tenantId` (el del guard, nunca el del body). El slug es inmutable: lo guarda
// `shop.orders.pago_metodo` como texto sin FK, así que un medio usado por algún pedido se
// desactiva, no se borra. Los errores viajan en usted.

type Fila = typeof mediosPagoShop.$inferSelect
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]

export interface MedioPagoDto {
  slug: string
  nombre: string
  instrucciones: string
  activo: boolean
  aplicaRetiro: boolean
  aplicaEnvio: boolean
  cobroOnline: boolean
  orden: number
  /** Lista de Alegra enlazada (null = lista por defecto) y snapshot de su nombre. */
  idListaPrecios: string | null
  listaPreciosNombre: string | null
  destacarEnCatalogo: boolean
  mostrarEnFicha: boolean
}

export type MedioPagoConAvisos = MedioPagoDto & { avisos: string[] }

export const toMedioPagoDto = (r: Fila): MedioPagoDto => ({
  slug: r.slug,
  nombre: r.nombre,
  instrucciones: r.instrucciones,
  activo: r.activo,
  aplicaRetiro: r.aplicaRetiro,
  aplicaEnvio: r.aplicaEnvio,
  cobroOnline: r.cobroOnline,
  orden: r.orden,
  idListaPrecios: r.idListaPrecios,
  listaPreciosNombre: r.listaPreciosNombre,
  destacarEnCatalogo: r.destacarEnCatalogo,
  mostrarEnFicha: r.mostrarEnFicha,
})

export type ResultadoMedio =
  | { kind: "ok"; medio: MedioPagoDto }
  | { kind: "invalid"; campo: string; error: string }
  | { kind: "conflict"; campo: string; error: string }
  | { kind: "not_found" }

export type ResultadoBorradoMedio = { kind: "ok" } | { kind: "conflict"; error: string } | { kind: "not_found" }

function codigoPg(err: unknown): string | undefined {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  return undefined
}

export async function listarMediosPago(tenantId: string): Promise<MedioPagoDto[]> {
  const filas = await getDb()
    .select()
    .from(mediosPagoShop)
    .where(eq(mediosPagoShop.tenantId, tenantId))
    .orderBy(asc(mediosPagoShop.orden), asc(mediosPagoShop.nombre))
  return filas.map(toMedioPagoDto)
}

/** Listas de precios de la cuenta principal de Alegra del tenant (para el selector de cada medio). */
export const listasDisponiblesParaMedios = listasDeLaPrincipal

/**
 * Ids de listas que en general cuestan MÁS que la lista por defecto: más productos con precio mayor
 * que con precio menor. Es un aviso informativo; si la consulta falla se omite (no bloquea nada).
 */
async function listasMasCaras(tenantId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  try {
    const filas = (await getDb().execute(sql`
      WITH base AS (
        SELECT p.prices,
          coalesce(
            (SELECT (e->>'price')::numeric FROM jsonb_array_elements(p.prices) e WHERE e->>'main' = 'true' LIMIT 1),
            (p.prices->0->>'price')::numeric
          ) AS general
        FROM catalog_products p
        WHERE p.tenant_id = ${tenantId} AND p.cuenta_id IS NULL AND jsonb_typeof(p.prices) = 'array'
      )
      SELECT e->>'idPriceList' AS id,
        count(*) FILTER (WHERE (e->>'price')::numeric > base.general) AS caras,
        count(*) FILTER (WHERE (e->>'price')::numeric > 0 AND (e->>'price')::numeric < base.general) AS baratas
      FROM base, jsonb_array_elements(base.prices) e
      WHERE e->>'idPriceList' IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      GROUP BY 1
    `)) as unknown as { id: string; caras: string | number; baratas: string | number }[]
    return new Set(filas.filter((f) => Number(f.caras) > Number(f.baratas)).map((f) => f.id))
  } catch {
    return new Set()
  }
}

/** Calcula los avisos no bloqueantes de cada medio (lista huérfana, más cara, destacado/ficha sin efecto). */
export async function conAvisos(tenantId: string, medios: MedioPagoDto[]): Promise<MedioPagoConAvisos[]> {
  const listas = await listasDeLaPrincipal(tenantId)
  const enlazadas = [...new Set(medios.map((m) => m.idListaPrecios).filter((x): x is string => x !== null))]
  const ctx = {
    listasExistentes: new Set(listas.map((l) => l.idPriceList)),
    listasMasCaras: await listasMasCaras(tenantId, enlazadas),
  }
  return medios.map((m) => ({ ...m, avisos: avisosDeMedio(m, ctx) }))
}

export async function listarMediosPagoConAvisos(
  tenantId: string,
): Promise<{ medios: MedioPagoConAvisos[]; listas: { idPriceList: string; name: string }[] }> {
  const medios = await listarMediosPago(tenantId)
  const [listas, conAv] = await Promise.all([listasDeLaPrincipal(tenantId), conAvisos(tenantId, medios)])
  return { medios: conAv, listas }
}

/** `slug -> nombre` de los medios del tenant (activos o no), para mostrar el elegido en un pedido. */
export async function nombresMediosPago(tenantId: string): Promise<Record<string, string>> {
  const filas = await getDb()
    .select({ slug: mediosPagoShop.slug, nombre: mediosPagoShop.nombre })
    .from(mediosPagoShop)
    .where(eq(mediosPagoShop.tenantId, tenantId))
  return Object.fromEntries(filas.map((f) => [f.slug, f.nombre]))
}

export async function crearMedioPago(tenantId: string, body: unknown): Promise<ResultadoMedio> {
  const v = validarMedioPagoNuevo(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  try {
    const [fila] = await getDb()
      .insert(mediosPagoShop)
      .values({ ...v.valor, tenantId })
      .returning()
    return { kind: "ok", medio: toMedioPagoDto(fila) }
  } catch (err) {
    if (codigoPg(err) === "23505") {
      return { kind: "conflict", campo: "slug", error: "Ya existe un medio de pago con ese identificador." }
    }
    throw err
  }
}

export async function actualizarMedioPago(tenantId: string, slug: string, body: unknown): Promise<ResultadoMedio> {
  const v = validarMedioPagoCambios(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  // `cobro_online` no se cambia desde el admin: lo fija la migración que siembra mercadopago.
  const cambios: CambiosMedioPago = { ...v.cambios }
  delete cambios.cobroOnline

  // Las listas se leen FUERA de la transacción (otra consulta, sin lock) y sólo si hace falta.
  const listas = typeof cambios.idListaPrecios === "string" ? await listasDeLaPrincipal(tenantId) : []

  try {
    return await actualizarEnTx(tenantId, slug, cambios, listas)
  } catch (err) {
    // Dos destacados simultáneos: el índice único parcial rechaza al segundo. No es un 500.
    if (codigoPg(err) === "23505" && cambios.destacarEnCatalogo === true) {
      return {
        kind: "conflict",
        campo: "destacarEnCatalogo",
        error: "Otro medio de pago se destacó al mismo tiempo. Actualice la página e inténtelo nuevamente.",
      }
    }
    throw err
  }
}

type CambiosConLista = CambiosMedioPago & { listaPreciosNombre?: string | null }

async function actualizarEnTx(
  tenantId: string,
  slug: string,
  cambios: CambiosMedioPago,
  listas: { idPriceList: string; name: string }[],
): Promise<ResultadoMedio> {
  return getDb().transaction(async (tx): Promise<ResultadoMedio> => {
    const [actual] = await tx
      .select()
      .from(mediosPagoShop)
      .where(and(eq(mediosPagoShop.tenantId, tenantId), eq(mediosPagoShop.slug, slug)))
      .for("update")
    if (!actual) return { kind: "not_found" }

    const set: CambiosConLista = { ...cambios }
    if (cambios.idListaPrecios !== undefined) {
      if (cambios.idListaPrecios !== null && cambios.idListaPrecios === actual.idListaPrecios) {
        // Mismo id que ya tenía (aunque la lista ya no exista en Alegra): se conserva el snapshot.
        delete set.listaPreciosNombre
      } else {
        const l = resolverListaDelMedio(cambios.idListaPrecios, listas)
        if (!l.ok) return { kind: "invalid", campo: l.campo, error: l.error }
        set.idListaPrecios = l.id
        set.listaPreciosNombre = l.nombre
      }
    }

    const retiro = cambios.aplicaRetiro ?? actual.aplicaRetiro
    const envio = cambios.aplicaEnvio ?? actual.aplicaEnvio
    if (!retiro && !envio) return { kind: "invalid", campo: "aplicaRetiro", error: MSG_SIN_ENTREGA }

    // Un solo destacado por tenant: se desmarca el anterior en la MISMA transacción.
    if (cambios.destacarEnCatalogo === true) {
      await tx
        .update(mediosPagoShop)
        .set({ destacarEnCatalogo: false, updatedAt: new Date() })
        .where(
          and(
            eq(mediosPagoShop.tenantId, tenantId),
            eq(mediosPagoShop.destacarEnCatalogo, true),
            sql`${mediosPagoShop.slug} <> ${slug}`,
          ),
        )
    }

    const [fila] = await tx
      .update(mediosPagoShop)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(mediosPagoShop.tenantId, tenantId), eq(mediosPagoShop.slug, slug)))
      .returning()
    return { kind: "ok", medio: toMedioPagoDto(fila) }
  })
}

/**
 * ¿Algún pedido del Shop eligió este medio? Consulta cruzada a `shop.orders.pago_metodo`.
 * Si el esquema `shop` no existe todavía (entorno sin Shop), ningún pedido puede usarlo.
 */
async function pedidosUsanMedio(tx: Tx, tenantId: string, slug: string): Promise<boolean> {
  const cols = await tx.execute(sql`
    select 1 from information_schema.columns
    where table_schema = 'shop' and table_name = 'orders' and column_name = 'pago_metodo'
  `)
  if (cols.length === 0) return false
  const filas = await tx.execute(sql`
    select 1 from shop.orders where tenant_id = ${tenantId} and pago_metodo = ${slug} limit 1
  `)
  return filas.length > 0
}

export async function eliminarMedioPago(tenantId: string, slug: string): Promise<ResultadoBorradoMedio> {
  if (slug === SLUG_MERCADOPAGO) {
    return { kind: "conflict", error: "Este medio de pago no se puede eliminar; desactívelo." }
  }
  return getDb().transaction(async (tx): Promise<ResultadoBorradoMedio> => {
    const [actual] = await tx
      .select({ slug: mediosPagoShop.slug })
      .from(mediosPagoShop)
      .where(and(eq(mediosPagoShop.tenantId, tenantId), eq(mediosPagoShop.slug, slug)))
      .for("update")
    if (!actual) return { kind: "not_found" }
    if (await pedidosUsanMedio(tx, tenantId, slug)) {
      return { kind: "conflict", error: "Hay pedidos que eligieron este medio de pago. Desactívelo en lugar de eliminarlo." }
    }
    await tx.delete(mediosPagoShop).where(and(eq(mediosPagoShop.tenantId, tenantId), eq(mediosPagoShop.slug, slug)))
    return { kind: "ok" }
  })
}
