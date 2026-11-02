import { and, asc, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { cuponCodigos, cuponPromociones, mediosPagoShop, preciosOnlineCambios } from "@/db/schema"
import { generateToken } from "./admin-crypto"
import { contarCanjes } from "./cupones-canjes"
import { generarCodigo } from "./cupones-codigo"
import {
  estadoPromocion,
  SLUG_A_COORDINAR,
  type EstadoPromocion,
  type FormaCupon,
  type PromocionEntrada,
  type TipoPromocion,
} from "./cupones-validar"
import { lockTenant, PreciosOnlineError, type Tx, type UsuarioActor } from "./precios-online-repo"

// Cupones de descuento (spec 2026-11-01-cupones-design.md): promociones y códigos. Los canjes son
// del Shop (`cupones-canjes.ts`). Las escrituras del admin van bajo el lock de Precios online, con
// historial en precios_online_cambios (tipo 'cupon'). La emisión del bot se serializa por
// promoción (`cupon-emitir:<id>`) para que una misma referencia no reciba dos códigos.

export { contarCanjes }

export interface PromocionDto extends PromocionEntrada {
  id: string
  estado: EstadoPromocion
  activa: boolean
  codigosEmitidos: number
  canjesUsados: number
  descuentoTotal: number
  tieneToken: boolean
}

export const LOTE_MAX = 500
/** Tope de emisión del bot: límite de canjes × 3 (frena abuso sin cortar conversiones). */
export const FACTOR_EMISION = 3
const INTENTOS_POR_CODIGO = 5

const MSG_NO_EXISTE = "La promoción indicada no existe."
const MSG_CODIGO_REPETIDO = "Ya existe un cupón con ese código."
const MSG_CON_CANJES = "La promoción ya tiene canjes: no se puede cambiar el tipo ni el descuento."
const MSG_SOLO_UNICOS = "Sólo las promociones de códigos únicos generan lotes y tokens."

type FilaPromocion = typeof cuponPromociones.$inferSelect

function errorPg(err: unknown): { code?: string; constraint?: string } {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === "string") {
      const c = e as { constraint_name?: unknown; constraint?: unknown }
      const constraint = typeof c.constraint_name === "string" ? c.constraint_name : typeof c.constraint === "string" ? c.constraint : undefined
      return { code, constraint }
    }
  }
  return {}
}

const esCodigoRepetido = (err: unknown) => {
  const { code, constraint } = errorPg(err)
  return code === "23505" && constraint === "cupon_codigos_tenant_norm"
}

async function ahoraTx(tx: Tx): Promise<Date> {
  const [r] = (await tx.execute(sql`SELECT now() AS n`)) as unknown as { n: Date | string }[]
  return new Date(r.n)
}

async function leerFila(tx: Tx, tenantId: string, id: string): Promise<FilaPromocion> {
  const [p] = await tx
    .select()
    .from(cuponPromociones)
    .where(and(eq(cuponPromociones.tenantId, tenantId), eq(cuponPromociones.id, id)))
    .for("update")
  if (!p) throw new PreciosOnlineError(404, "promocion_no_existe", MSG_NO_EXISTE)
  return p
}

async function registrar(
  tx: Tx,
  tenantId: string,
  actor: UsuarioActor,
  id: string,
  operacion: "alta" | "edicion" | "pausa" | "reanudacion" | "baja" | "lote" | "token" | "token_revocado",
  antes: Record<string, unknown> | null,
  despues: Record<string, unknown> | null,
  nombre: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(preciosOnlineCambios).values({
    tenantId,
    tipo: "cupon",
    objeto: `cupon:${id}`,
    antes,
    despues,
    resumen: { operacion, promocion: nombre, ...extra },
    usuario: actor.email || actor.id,
    creadoAt: sql`clock_timestamp()`,
  })
}

/** Los medios deben existir en el tenant y ser públicos; `a_coordinar` no es una fila. */
async function validarMedios(tx: Tx, tenantId: string, medios: string[] | null): Promise<void> {
  const slugs = (medios ?? []).filter((m) => m !== SLUG_A_COORDINAR)
  if (slugs.length === 0) return
  const filas = await tx
    .select({ slug: mediosPagoShop.slug, audiencia: mediosPagoShop.audiencia })
    .from(mediosPagoShop)
    .where(eq(mediosPagoShop.tenantId, tenantId))
  const porSlug = new Map(filas.map((f) => [f.slug, f.audiencia]))
  for (const s of slugs) {
    const audiencia = porSlug.get(s)
    if (audiencia === "cuenta_corriente") {
      throw new PreciosOnlineError(422, "medio_no_admitido", "El medio de cuenta corriente no acepta cupones.")
    }
    if (audiencia === undefined) {
      throw new PreciosOnlineError(422, "medio_no_admitido", "Hay un medio de pago que no existe.")
    }
  }
}

const columnas = (e: PromocionEntrada) => ({
  nombre: e.nombre,
  tipo: e.tipo,
  pct: e.pct,
  envioGratis: e.envioGratis,
  provinciasEnvio: e.provinciasEnvio,
  inicio: new Date(e.inicio),
  fin: new Date(e.fin),
  venceDiasDesdeEmision: e.venceDiasDesdeEmision,
  soloPrimeraCompra: e.soloPrimeraCompra,
  minimo: e.minimo === null ? null : e.minimo.toFixed(2),
  medios: e.medios,
  formas: e.formas,
  permiteCuotas: e.permiteCuotas,
  limiteCanjes: e.limiteCanjes,
  condiciones: e.condiciones,
  prefijo: e.tipo === "unicos" ? (e.prefijo ?? null) : null,
})

function entradaDe(p: FilaPromocion, codigo: string | null): PromocionEntrada {
  return {
    nombre: p.nombre,
    tipo: p.tipo as TipoPromocion,
    ...(p.tipo === "generica" && codigo ? { codigo } : {}),
    ...(p.tipo === "unicos" && p.prefijo ? { prefijo: p.prefijo } : {}),
    pct: p.pct,
    envioGratis: p.envioGratis,
    provinciasEnvio: p.provinciasEnvio,
    inicio: p.inicio.toISOString(),
    fin: p.fin.toISOString(),
    venceDiasDesdeEmision: p.venceDiasDesdeEmision,
    soloPrimeraCompra: p.soloPrimeraCompra,
    minimo: p.minimo === null ? null : Number(p.minimo),
    medios: p.medios,
    formas: p.formas as FormaCupon[] | null,
    permiteCuotas: p.permiteCuotas,
    limiteCanjes: p.limiteCanjes,
    condiciones: p.condiciones,
  }
}

async function codigoManual(tx: Tx, promocionId: string): Promise<{ id: string; codigo: string } | null> {
  const [c] = await tx
    .select({ id: cuponCodigos.id, codigo: cuponCodigos.codigo })
    .from(cuponCodigos)
    .where(and(eq(cuponCodigos.promocionId, promocionId), eq(cuponCodigos.origen, "manual")))
    .limit(1)
  return c ?? null
}

/** Inserta `cantidad` códigos `<PREFIJO>-XXXXX`; un choque con otro código se reintenta. */
async function insertarUnicos(
  tx: Tx,
  p: FilaPromocion,
  origen: "lote" | "integracion",
  cantidad: number,
  referencia: string | null = null,
): Promise<{ codigo: string; venceEn: Date | null }[]> {
  const venceEn = p.venceDiasDesdeEmision
    ? sql`now() + make_interval(days => ${p.venceDiasDesdeEmision}::int)`
    : null
  const salida: { codigo: string; venceEn: Date | null }[] = []
  for (let i = 0; i < cantidad; i++) {
    let fila: { codigo: string; venceEn: Date | null } | undefined
    for (let intento = 0; intento < INTENTOS_POR_CODIGO && !fila; intento++) {
      ;[fila] = await tx
        .insert(cuponCodigos)
        .values({
          promocionId: p.id,
          tenantId: p.tenantId,
          codigo: generarCodigo(p.prefijo!),
          origen,
          referenciaExterna: referencia,
          venceEn,
        })
        .onConflictDoNothing({ target: [cuponCodigos.tenantId, cuponCodigos.codigoNorm] })
        .returning({ codigo: cuponCodigos.codigo, venceEn: cuponCodigos.venceEn })
    }
    if (!fila) throw new Error(`cupones: sin código libre para el prefijo ${p.prefijo} tras ${INTENTOS_POR_CODIGO} intentos`)
    salida.push(fila)
  }
  return salida
}

export async function guardarPromocion(
  tenantId: string,
  e: PromocionEntrada,
  actor: UsuarioActor,
  id?: string,
): Promise<{ id: string }> {
  try {
    return await getDb().transaction(async (tx) => {
      await lockTenant(tx, tenantId)
      await validarMedios(tx, tenantId, e.medios)

      if (!id) {
        const [p] = await tx
          .insert(cuponPromociones)
          .values({ tenantId, ...columnas(e), creadoPor: actor.email || actor.id })
          .returning({ id: cuponPromociones.id })
        if (e.tipo === "generica") {
          await tx.insert(cuponCodigos).values({ promocionId: p.id, tenantId, codigo: e.codigo!, origen: "manual" })
        }
        await registrar(tx, tenantId, actor, p.id, "alta", null, { ...e }, e.nombre)
        return { id: p.id }
      }

      const previa = await leerFila(tx, tenantId, id)
      const manual = await codigoManual(tx, id)
      const antes = entradaDe(previa, manual?.codigo ?? null)
      if (previa.tipo !== e.tipo || previa.pct !== e.pct) {
        if ((await contarCanjes(tx, id)) > 0) throw new PreciosOnlineError(409, "promocion_con_canjes", MSG_CON_CANJES)
      }
      if (previa.tipo !== e.tipo) {
        const [{ n }] = (await tx.execute(
          sql`SELECT count(*)::int AS n FROM cupon_codigos WHERE promocion_id = ${id} AND origen <> 'manual'`,
        )) as unknown as { n: number }[]
        if (Number(n) > 0) {
          throw new PreciosOnlineError(409, "promocion_con_codigos", "La promoción ya emitió códigos: no se puede cambiar el tipo.")
        }
      }
      await tx
        .update(cuponPromociones)
        .set({ ...columnas(e), updatedAt: sql`now()` })
        .where(eq(cuponPromociones.id, id))
      if (e.tipo === "generica") {
        if (manual) await tx.update(cuponCodigos).set({ codigo: e.codigo! }).where(eq(cuponCodigos.id, manual.id))
        else await tx.insert(cuponCodigos).values({ promocionId: id, tenantId, codigo: e.codigo!, origen: "manual" })
      } else if (manual) {
        await tx.delete(cuponCodigos).where(eq(cuponCodigos.id, manual.id))
      }
      await registrar(tx, tenantId, actor, id, "edicion", { ...antes }, { ...e }, e.nombre)
      return { id }
    })
  } catch (err) {
    if (esCodigoRepetido(err)) throw new PreciosOnlineError(409, "codigo_repetido", MSG_CODIGO_REPETIDO)
    throw err
  }
}

export async function pausarPromocion(tenantId: string, id: string, activa: boolean, actor: UsuarioActor): Promise<void> {
  await getDb().transaction(async (tx) => {
    await lockTenant(tx, tenantId)
    const p = await leerFila(tx, tenantId, id)
    if (p.activa === activa) return
    await tx.update(cuponPromociones).set({ activa, updatedAt: sql`now()` }).where(eq(cuponPromociones.id, id))
    await registrar(tx, tenantId, actor, id, activa ? "reanudacion" : "pausa", { activa: p.activa }, { activa }, p.nombre)
  })
}

export async function eliminarPromocion(tenantId: string, id: string, actor: UsuarioActor): Promise<void> {
  await getDb().transaction(async (tx) => {
    await lockTenant(tx, tenantId)
    const p = await leerFila(tx, tenantId, id)
    if ((await contarCanjes(tx, id)) > 0) {
      throw new PreciosOnlineError(409, "promocion_con_canjes", "La promoción tiene canjes: no se puede eliminar.")
    }
    await tx.delete(cuponPromociones).where(eq(cuponPromociones.id, id))
    await registrar(tx, tenantId, actor, id, "baja", { ...entradaDe(p, null) }, null, p.nombre)
  })
}

export async function generarLote(tenantId: string, id: string, cantidad: number, actor: UsuarioActor): Promise<string[]> {
  return getDb().transaction(async (tx) => {
    await lockTenant(tx, tenantId)
    const p = await leerFila(tx, tenantId, id)
    if (p.tipo !== "unicos") throw new PreciosOnlineError(422, "solo_unicos", MSG_SOLO_UNICOS)
    const codigos = await insertarUnicos(tx, p, "lote", cantidad)
    await registrar(tx, tenantId, actor, id, "lote", null, null, p.nombre, { cantidad })
    return codigos.map((c) => c.codigo)
  })
}

/** Genera (o reemplaza) el token del bot: se devuelve una sola vez; queda sólo su hash. */
export async function generarTokenIntegracion(tenantId: string, id: string, actor: UsuarioActor): Promise<{ token: string }> {
  return getDb().transaction(async (tx) => {
    await lockTenant(tx, tenantId)
    const p = await leerFila(tx, tenantId, id)
    if (p.tipo !== "unicos") throw new PreciosOnlineError(422, "solo_unicos", MSG_SOLO_UNICOS)
    const { token, tokenHash } = generateToken()
    await tx
      .update(cuponPromociones)
      .set({ tokenHash, tokenCreadoEn: sql`now()`, updatedAt: sql`now()` })
      .where(eq(cuponPromociones.id, id))
    await registrar(tx, tenantId, actor, id, "token", null, null, p.nombre)
    return { token }
  })
}

export async function revocarTokenIntegracion(tenantId: string, id: string, actor: UsuarioActor): Promise<void> {
  await getDb().transaction(async (tx) => {
    await lockTenant(tx, tenantId)
    const p = await leerFila(tx, tenantId, id)
    if (p.tokenHash === null) return
    await tx
      .update(cuponPromociones)
      .set({ tokenHash: null, tokenCreadoEn: null, updatedAt: sql`now()` })
      .where(eq(cuponPromociones.id, id))
    await registrar(tx, tenantId, actor, id, "token_revocado", null, null, p.nombre)
  })
}

/** La promoción dueña del token del bot (por igualdad del hash, índice único). */
export async function promocionPorToken(tokenHash: string): Promise<{ id: string; tenantId: string } | null> {
  const [p] = await getDb()
    .select({ id: cuponPromociones.id, tenantId: cuponPromociones.tenantId })
    .from(cuponPromociones)
    .where(eq(cuponPromociones.tokenHash, tokenHash))
  return p ?? null
}

/**
 * Código único para una referencia del bot. Misma referencia → mismo código (`nuevo: false`), aunque
 * ya esté usado o la promoción esté pausada. Uno nuevo exige la promoción activa y respeta el tope
 * de emisión (límite × 3).
 */
export async function emitirCodigo(
  tenantId: string,
  promocionId: string,
  referencia: string,
): Promise<{ codigo: string; venceEn: string | null; nuevo: boolean }> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"cupon-emitir:" + promocionId}, 0))`)
    const [previo] = await tx
      .select({ codigo: cuponCodigos.codigo, venceEn: cuponCodigos.venceEn })
      .from(cuponCodigos)
      .where(and(eq(cuponCodigos.promocionId, promocionId), eq(cuponCodigos.referenciaExterna, referencia)))
    if (previo) return { codigo: previo.codigo, venceEn: previo.venceEn?.toISOString() ?? null, nuevo: false }

    const [p] = await tx
      .select()
      .from(cuponPromociones)
      .where(and(eq(cuponPromociones.tenantId, tenantId), eq(cuponPromociones.id, promocionId)))
    if (!p) throw new PreciosOnlineError(404, "promocion_no_existe", MSG_NO_EXISTE)
    if (p.tipo !== "unicos" || estadoPromocion(p, await ahoraTx(tx)) !== "activa") {
      throw new PreciosOnlineError(409, "promocion_inactiva", "La promoción no está activa.")
    }
    if (p.limiteCanjes !== null) {
      const [{ n }] = (await tx.execute(
        sql`SELECT count(*)::int AS n FROM cupon_codigos WHERE promocion_id = ${promocionId} AND origen = 'integracion'`,
      )) as unknown as { n: number }[]
      if (Number(n) >= p.limiteCanjes * FACTOR_EMISION) {
        throw new PreciosOnlineError(409, "limite_alcanzado", "La promoción alcanzó su tope de códigos.")
      }
    }
    const [c] = await insertarUnicos(tx, p, "integracion", 1, referencia)
    return { codigo: c.codigo, venceEn: c.venceEn?.toISOString() ?? null, nuevo: true }
  })
}

async function aDtos(tenantId: string, filas: FilaPromocion[]): Promise<PromocionDto[]> {
  if (filas.length === 0) return []
  const db = getDb()
  const conteos = (await db.execute(sql`
    SELECT promocion_id, count(*)::int AS n,
           max(codigo) FILTER (WHERE origen = 'manual') AS manual
    FROM cupon_codigos WHERE tenant_id = ${tenantId}
    GROUP BY promocion_id`)) as unknown as { promocion_id: string; n: number; manual: string | null }[]
  const porId = new Map(conteos.map((c) => [c.promocion_id, c]))
  const [{ ahora }] = (await db.execute(sql`SELECT now() AS ahora`)) as unknown as { ahora: Date | string }[]
  return filas.map((p) => {
    const c = porId.get(p.id)
    return {
      ...entradaDe(p, c?.manual ?? null),
      id: p.id,
      estado: estadoPromocion(p, new Date(ahora)),
      activa: p.activa,
      codigosEmitidos: Number(c?.n ?? 0),
      canjesUsados: 0,
      descuentoTotal: 0,
      tieneToken: p.tokenHash !== null,
    }
  })
}

export async function listarPromociones(tenantId: string): Promise<PromocionDto[]> {
  const filas = await getDb()
    .select()
    .from(cuponPromociones)
    .where(eq(cuponPromociones.tenantId, tenantId))
    .orderBy(sql`${cuponPromociones.fin} DESC`, asc(cuponPromociones.nombre))
  return aDtos(tenantId, filas)
}

export async function leerPromocion(tenantId: string, id: string): Promise<PromocionDto | null> {
  const filas = await getDb()
    .select()
    .from(cuponPromociones)
    .where(and(eq(cuponPromociones.tenantId, tenantId), eq(cuponPromociones.id, id)))
  const [dto] = await aDtos(tenantId, filas)
  return dto ?? null
}
