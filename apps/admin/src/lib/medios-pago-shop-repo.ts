import { and, asc, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { listaPrecioCondiciones, listasPrecioOnline, mediosPagoShop } from "@/db/schema"
import { leerChips, type ChipMedio } from "@/lib/medios-pago-shop-chips"
import { avisosDeMedio } from "@/lib/medios-pago-shop-avisos"
import { OPCIONES_COBRO, errorDeOpcionesResultantes, type OpcionCobro } from "@/lib/medios-pago-shop-opciones"
import { consultarInteresDeReferencia, type InteresMPCuenta } from "@/lib/mercadopago-planes-aviso"
import {
  AUDIENCIA_CUENTA_CORRIENTE,
  MSG_CC_COBRO_ONLINE,
  MSG_CC_ENTREGA,
  MSG_CC_OTRO,
  MSG_CC_PRECIOS,
  MSG_SIN_ENTREGA,
  SLUG_MERCADOPAGO,
  type AudienciaMedio,
  esSlugCobro,
  esMedioDelSistema,
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
  /**
   * Lista de precio online enlazada por la condición de pago único (null = rige la lista de
   * referencia). El enlace se cambia desde Precios online (vista previa + historial), no por PATCH.
   */
  listaOnlineId: string | null
  listaOnlineNombre: string | null
  listaOnlineActiva: boolean
  /**
   * Cuotas sin interés (rebanada D): una condición por cantidad N >= 2, con la lista online cuyo
   * precio se divide en N. Ascendentes. Sólo tienen efecto en el Shop para un medio con cobro en línea.
   */
  condicionesCuotas: CondicionCuotasDto[]
  destacarEnCatalogo: boolean
  mostrarEnFicha: boolean
  /** `cuenta_corriente` = solo lo ofrece el Shop a clientes con cuenta corriente (a lo sumo uno por tenant). */
  audiencia: AudienciaMedio
  /** Etiquetas que el checkout muestra sobre este medio (hasta 3, en este orden). */
  chips: ChipMedio[]
  /** Formas de pago del cobro en línea habilitadas (orden canónico). Sólo tienen efecto con cobro en línea. */
  opcionesCobro: OpcionCobro[]
  /**
   * Listas por forma de pago (0076): una condición de pago único con forma, sólo en Mercado Pago y Payway.
   * La forma sin fila hereda la lista del medio (`listaOnlineId`).
   */
  listasPorForma: ListaPorFormaDto[]
}

export interface ListaPorFormaDto {
  forma: OpcionCobro
  listaId: string
  listaNombre: string
  listaActiva: boolean
}

export interface CondicionCuotasDto {
  cuotas: number
  /** Mínimo CON impuestos (texto numérico) desde el que se ofrece esta cantidad de cuotas; null = sin mínimo. */
  montoMinimo: string | null
  /** Tarjetas a las que aplica (ids de marcas-tarjeta.ts); null = todas. */
  marcas: string[] | null
  listaId: string
  listaNombre: string
  listaActiva: boolean
}

export type MedioPagoConAvisos = MedioPagoDto & { avisos: string[] }

export interface CondicionMedio {
  listaId: string
  listaNombre: string
  listaActiva: boolean
}

export const toMedioPagoDto = (
  r: Fila,
  cond: CondicionMedio | null = null,
  condicionesCuotas: CondicionCuotasDto[] = [],
  listasPorForma: ListaPorFormaDto[] = [],
): MedioPagoDto => ({
  slug: r.slug,
  nombre: r.nombre,
  instrucciones: r.instrucciones,
  activo: r.activo,
  aplicaRetiro: r.aplicaRetiro,
  aplicaEnvio: r.aplicaEnvio,
  cobroOnline: r.cobroOnline,
  orden: r.orden,
  listaOnlineId: cond?.listaId ?? null,
  listaOnlineNombre: cond?.listaNombre ?? null,
  listaOnlineActiva: cond?.listaActiva ?? false,
  condicionesCuotas,
  destacarEnCatalogo: r.destacarEnCatalogo,
  mostrarEnFicha: r.mostrarEnFicha,
  audiencia: r.audiencia === AUDIENCIA_CUENTA_CORRIENTE ? AUDIENCIA_CUENTA_CORRIENTE : "publico",
  chips: leerChips(r.chips),
  opcionesCobro: OPCIONES_COBRO.filter((o) => r.opcionesCobro.includes(o)),
  listasPorForma,
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

/** ¿La violación de unicidad es la del índice del medio de cuenta corriente (0069)? */
function esConflictoCuentaCorriente(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { constraint_name?: unknown }).constraint_name === "medios_pago_shop_tenant_cc_uniq") return true
  }
  return false
}

export async function listarMediosPago(tenantId: string): Promise<MedioPagoDto[]> {
  const filas = await getDb()
    .select()
    .from(mediosPagoShop)
    .where(eq(mediosPagoShop.tenantId, tenantId))
    .orderBy(asc(mediosPagoShop.orden), asc(mediosPagoShop.nombre))
  const conds = await condicionesDePagoUnico(tenantId)
  const cuotas = await condicionesDeCuotas(tenantId)
  const porForma = await condicionesPorForma(tenantId)
  return filas.map((f) => toMedioPagoDto(f, conds.get(f.slug) ?? null, cuotas.get(f.slug) ?? [], porForma.get(f.slug) ?? []))
}

/** Condición de pago único (cuotas NULL) de cada medio: slug -> lista enlazada. */
async function condicionesDePagoUnico(tenantId: string, ej: Pick<ReturnType<typeof getDb>, "select"> = getDb()) {
  const filas = await ej
    .select({
      slug: listaPrecioCondiciones.medioSlug,
      listaId: listasPrecioOnline.id,
      listaNombre: listasPrecioOnline.nombre,
      listaActiva: listasPrecioOnline.activa,
    })
    .from(listaPrecioCondiciones)
    .innerJoin(listasPrecioOnline, eq(listasPrecioOnline.id, listaPrecioCondiciones.listaId))
    .where(
      and(
        eq(listaPrecioCondiciones.tenantId, tenantId),
        sql`${listaPrecioCondiciones.cuotas} IS NULL`,
        // Las filas por forma de pago (0076) no son la lista del medio.
        sql`${listaPrecioCondiciones.forma} IS NULL`,
      ),
    )
  return new Map<string, CondicionMedio>(filas.map((f) => [f.slug, f]))
}

/** Condiciones de pago único por forma de pago (0076) de cada medio: slug -> una por forma, en orden canónico. */
async function condicionesPorForma(tenantId: string, ej: Pick<ReturnType<typeof getDb>, "select"> = getDb()) {
  const filas = await ej
    .select({
      slug: listaPrecioCondiciones.medioSlug,
      forma: listaPrecioCondiciones.forma,
      listaId: listasPrecioOnline.id,
      listaNombre: listasPrecioOnline.nombre,
      listaActiva: listasPrecioOnline.activa,
    })
    .from(listaPrecioCondiciones)
    .innerJoin(listasPrecioOnline, eq(listasPrecioOnline.id, listaPrecioCondiciones.listaId))
    .where(
      and(
        eq(listaPrecioCondiciones.tenantId, tenantId),
        sql`${listaPrecioCondiciones.cuotas} IS NULL`,
        sql`${listaPrecioCondiciones.forma} IS NOT NULL`,
      ),
    )
  const porMedio = new Map<string, ListaPorFormaDto[]>()
  for (const f of filas) {
    // Una forma desconocida (otra versión) se ignora.
    const forma = OPCIONES_COBRO.find((o) => o === f.forma)
    if (!forma) continue
    const arr = porMedio.get(f.slug) ?? []
    arr.push({ forma, listaId: f.listaId, listaNombre: f.listaNombre, listaActiva: f.listaActiva })
    porMedio.set(f.slug, arr)
  }
  for (const arr of porMedio.values()) arr.sort((a, b) => OPCIONES_COBRO.indexOf(a.forma) - OPCIONES_COBRO.indexOf(b.forma))
  return porMedio
}

/** Condiciones de cuotas (N >= 2) de cada medio: slug -> condiciones ascendentes. */
async function condicionesDeCuotas(tenantId: string, ej: Pick<ReturnType<typeof getDb>, "select"> = getDb()) {
  const filas = await ej
    .select({
      slug: listaPrecioCondiciones.medioSlug,
      cuotas: listaPrecioCondiciones.cuotas,
      montoMinimo: listaPrecioCondiciones.montoMinimo,
      marcas: listaPrecioCondiciones.marcas,
      listaId: listasPrecioOnline.id,
      listaNombre: listasPrecioOnline.nombre,
      listaActiva: listasPrecioOnline.activa,
    })
    .from(listaPrecioCondiciones)
    .innerJoin(listasPrecioOnline, eq(listasPrecioOnline.id, listaPrecioCondiciones.listaId))
    .where(and(eq(listaPrecioCondiciones.tenantId, tenantId), sql`${listaPrecioCondiciones.cuotas} IS NOT NULL`))
    .orderBy(asc(listaPrecioCondiciones.cuotas))
  const porMedio = new Map<string, CondicionCuotasDto[]>()
  for (const f of filas) {
    if (f.cuotas === null) continue
    const arr = porMedio.get(f.slug) ?? []
    arr.push({
      cuotas: f.cuotas,
      montoMinimo: f.montoMinimo,
      marcas: f.marcas,
      listaId: f.listaId,
      listaNombre: f.listaNombre,
      listaActiva: f.listaActiva,
    })
    porMedio.set(f.slug, arr)
  }
  return porMedio
}

/** Listas de precio online activas del tenant (para el selector de cada medio). */
export async function listasDisponiblesParaMedios(tenantId: string): Promise<{ id: string; nombre: string }[]> {
  return getDb()
    .select({ id: listasPrecioOnline.id, nombre: listasPrecioOnline.nombre })
    .from(listasPrecioOnline)
    .where(and(eq(listasPrecioOnline.tenantId, tenantId), eq(listasPrecioOnline.activa, true), eq(listasPrecioOnline.privada, false)))
    .orderBy(asc(listasPrecioOnline.orden), asc(listasPrecioOnline.nombre))
}

/**
 * Ids de listas online que en general cuestan MÁS que la de referencia: más productos con precio
 * mayor que con precio menor. Es un aviso informativo (DC2: avisar, no bloquear); si la consulta
 * falla se omite.
 */
async function listasMasCaras(tenantId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  try {
    const filas = (await getDb().execute(sql`
      SELECT e->>'idPriceList' AS id,
        count(*) FILTER (WHERE (e->>'price')::numeric > p.precio_online_ref) AS caras,
        count(*) FILTER (WHERE (e->>'price')::numeric < p.precio_online_ref) AS baratas
      FROM catalog_products p, jsonb_array_elements(p.precios_online) e
      WHERE p.tenant_id = ${tenantId} AND p.precio_online_ref IS NOT NULL
        AND e->>'idPriceList' IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      GROUP BY 1
    `)) as unknown as { id: string; caras: string | number; baratas: string | number }[]
    return new Set(filas.filter((f) => Number(f.caras) > Number(f.baratas)).map((f) => f.id))
  } catch {
    return new Set()
  }
}

/** Monto de referencia para preguntarle a Mercado Pago por las cuotas: alcanza para las cantidades sin mínimo. */
const MONTO_REFERENCIA_MP = 100_000

/**
 * Cuotas con interés en Mercado Pago, sólo si hay algo que comparar (Mercado Pago activo con cuotas sin
 * interés configuradas). Es un aviso informativo: sin clave pública o con Mercado Pago caído se omite.
 */
async function interesDeMercadoPago(medios: MedioPagoDto[]): Promise<InteresMPCuenta[]> {
  const mp = medios.find((m) => m.slug === SLUG_MERCADOPAGO && m.activo && m.condicionesCuotas.length > 0)
  if (!mp) return []
  const minimos = mp.condicionesCuotas.map((c) => Number(c.montoMinimo)).filter((n) => Number.isFinite(n))
  try {
    return await consultarInteresDeReferencia(Math.ceil(Math.max(MONTO_REFERENCIA_MP, ...minimos)))
  } catch {
    return []
  }
}

/**
 * Calcula los avisos no bloqueantes de cada medio (lista desactivada, más cara, destacado/ficha sin
 * efecto, cuotas sin interés que Mercado Pago cobra con interés).
 */
export async function conAvisos(tenantId: string, medios: MedioPagoDto[]): Promise<MedioPagoConAvisos[]> {
  const enlazadas = [...new Set(medios.map((m) => m.listaOnlineId).filter((x): x is string => x !== null))]
  const [masCaras, interesMP] = await Promise.all([listasMasCaras(tenantId, enlazadas), interesDeMercadoPago(medios)])
  const ctx = { listasMasCaras: masCaras, interesMP }
  return medios.map((m) => ({ ...m, avisos: avisosDeMedio(m, ctx) }))
}

/** La lista de referencia del tenant (la que rige en un medio sin lista), o null si no hay. */
export async function listaDeReferencia(tenantId: string): Promise<{ id: string; nombre: string } | null> {
  const [fila] = await getDb()
    .select({ id: listasPrecioOnline.id, nombre: listasPrecioOnline.nombre })
    .from(listasPrecioOnline)
    .where(and(eq(listasPrecioOnline.tenantId, tenantId), eq(listasPrecioOnline.esReferencia, true)))
    .limit(1)
  return fila ?? null
}

export async function listarMediosPagoConAvisos(tenantId: string): Promise<{
  medios: MedioPagoConAvisos[]
  listas: { id: string; nombre: string }[]
  listaReferencia: { id: string; nombre: string } | null
}> {
  const medios = await listarMediosPago(tenantId)
  const [listas, listaReferencia, conAv] = await Promise.all([
    listasDisponiblesParaMedios(tenantId),
    listaDeReferencia(tenantId),
    conAvisos(tenantId, medios),
  ])
  return { medios: conAv, listas, listaReferencia }
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
      if (esConflictoCuentaCorriente(err)) return { kind: "conflict", campo: "audiencia", error: MSG_CC_OTRO }
      return { kind: "conflict", campo: "slug", error: "Ya existe un medio de pago con ese identificador." }
    }
    throw err
  }
}

export async function actualizarMedioPago(tenantId: string, slug: string, body: unknown): Promise<ResultadoMedio> {
  const v = validarMedioPagoCambios(body)
  if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
  // `cobro_online` no se cambia desde el admin: lo fijan las migraciones que siembran mercadopago y payway.
  const cambios: CambiosMedioPago = { ...v.cambios }
  delete cambios.cobroOnline

  try {
    return await actualizarEnTx(tenantId, slug, cambios)
  } catch (err) {
    // Dos destacados simultáneos: el índice único parcial rechaza al segundo. No es un 500.
    if (codigoPg(err) === "23505" && (esConflictoCuentaCorriente(err) || cambios.audiencia === AUDIENCIA_CUENTA_CORRIENTE)) {
      return { kind: "conflict", campo: "audiencia", error: MSG_CC_OTRO }
    }
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

async function actualizarEnTx(
  tenantId: string,
  slug: string,
  cambios: CambiosMedioPago,
): Promise<ResultadoMedio> {
  return getDb().transaction(async (tx): Promise<ResultadoMedio> => {
    const [actual] = await tx
      .select()
      .from(mediosPagoShop)
      .where(and(eq(mediosPagoShop.tenantId, tenantId), eq(mediosPagoShop.slug, slug)))
      .for("update")
    if (!actual) return { kind: "not_found" }

    const retiro = cambios.aplicaRetiro ?? actual.aplicaRetiro
    const envio = cambios.aplicaEnvio ?? actual.aplicaEnvio
    if (!retiro && !envio) return { kind: "invalid", campo: "aplicaRetiro", error: MSG_SIN_ENTREGA }

    const errorOpciones = errorDeOpcionesResultantes({
      slug,
      activo: cambios.activo ?? actual.activo,
      cobroOnline: actual.cobroOnline,
      opcionesCobro: cambios.opcionesCobro ?? actual.opcionesCobro,
    })
    if (errorOpciones) return { kind: "invalid", campo: "opcionesCobro", error: errorOpciones }

    // Medio solo para cuentas corrientes: se valida contra el estado RESULTANTE (también al editar uno ya marcado).
    const audiencia = cambios.audiencia ?? actual.audiencia
    if (audiencia === AUDIENCIA_CUENTA_CORRIENTE) {
      if (esSlugCobro(slug) || actual.cobroOnline) return { kind: "invalid", campo: "audiencia", error: MSG_CC_COBRO_ONLINE }
      if (!(retiro && envio)) return { kind: "invalid", campo: "aplicaRetiro", error: MSG_CC_ENTREGA }
      if ((cambios.destacarEnCatalogo ?? actual.destacarEnCatalogo) || (cambios.mostrarEnFicha ?? actual.mostrarEnFicha)) {
        return { kind: "invalid", campo: "audiencia", error: MSG_CC_PRECIOS }
      }
      if (cambios.audiencia === AUDIENCIA_CUENTA_CORRIENTE) {
        const [otro] = await tx
          .select({ slug: mediosPagoShop.slug })
          .from(mediosPagoShop)
          .where(
            and(
              eq(mediosPagoShop.tenantId, tenantId),
              eq(mediosPagoShop.audiencia, AUDIENCIA_CUENTA_CORRIENTE),
              sql`${mediosPagoShop.slug} <> ${slug}`,
            ),
          )
        if (otro) return { kind: "conflict", campo: "audiencia", error: MSG_CC_OTRO }
      }
    }

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
      .set({ ...cambios, updatedAt: new Date() })
      .where(and(eq(mediosPagoShop.tenantId, tenantId), eq(mediosPagoShop.slug, slug)))
      .returning()
    const cond = (await condicionesDePagoUnico(tenantId, tx)).get(slug) ?? null
    const cuotas = (await condicionesDeCuotas(tenantId, tx)).get(slug) ?? []
    const porForma = (await condicionesPorForma(tenantId, tx)).get(slug) ?? []
    return { kind: "ok", medio: toMedioPagoDto(fila, cond, cuotas, porForma) }
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
  if (esMedioDelSistema(slug)) {
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
