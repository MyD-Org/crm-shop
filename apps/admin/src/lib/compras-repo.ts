import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm"
import { getDb, type Db } from "@/db"
import {
  compraItems,
  compraPercepciones,
  compraRecepcionItems,
  compraRecepciones,
  compras,
} from "@/db/schema"
import { ErrorCompras } from "@/lib/compras-dinero"
import type { EstadoCompra } from "@/lib/compras-estado"

// Acceso a datos de Compras (change `compras-en-transito`). SQL por drizzle.
//
// Reglas de este archivo:
//  - `tenantId` es SIEMPRE el primer argumento (lo da el guard de la ruta, nunca el cliente) y se
//    filtra en TODA consulta; un id de otro tenant se comporta como inexistente.
//  - Las escrituras que modifican una compra existente van dentro de `conLockCompra`: transacción
//    corta con `pg_advisory_xact_lock` por compra. NUNCA se mantiene una transacción abierta
//    mientras se llama a Alegra (el lock lógico durante la red es el índice único de la recepción
//    en vuelo).
//  - Lo recibido de cada ítem es la suma de las recepciones 'aplicada'; `compra_items.
//    cantidad_recibida` es una caché que se recalcula desde esa suma en la misma transacción.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export type DbOTx = Db | Tx

export type CompraFila = typeof compras.$inferSelect
export type CompraItemFila = typeof compraItems.$inferSelect
export type CompraPercepcionFila = typeof compraPercepciones.$inferSelect
export type RecepcionFila = typeof compraRecepciones.$inferSelect

export interface NuevoItem {
  alegraId: string
  itemIdCuenta: string
  codigo?: string | null
  nombre: string
  /** Numérico como texto con hasta 3 decimales: "1.500". */
  cantidadPedida: string
  costoUnitarioCentavos: number
  ivaPorcentaje: string
  taxAlegraId: string
  netoE5: number
}

export interface NuevaPercepcion {
  alegraPerceptionId: string
  nombre: string
  importeCentavos: number
  numeroCertificado?: string | null
}

export interface NuevaCompra {
  cuentaId: string
  proveedorAlegraId: string
  proveedorNombre: string
  proveedorCuit?: string | null
  numeroFactura: string
  fecha: string
  vencimiento: string
  observaciones?: string | null
  almacenId: string
  idempotencyKey: string
  creadaPor?: string | null
  netoCentavos: number
  ivaCentavos: number
  percepcionesCentavos: number
  totalCentavos: number
  items: NuevoItem[]
  percepciones: NuevaPercepcion[]
}

export interface CompraCompleta extends CompraFila {
  items: CompraItemFila[]
  percepcionesDetalle: CompraPercepcionFila[]
  recepciones: RecepcionFila[]
}

function esViolacionUnica(e: unknown, indice?: string): boolean {
  const cand = [e, (e as { cause?: unknown })?.cause] as { code?: string; constraint_name?: string }[]
  return cand.some((c) => c?.code === "23505" && (!indice || c.constraint_name === indice))
}

/**
 * Crea la compra (estado 'creando', todavía sin bill) con sus ítems y percepciones en una sola
 * transacción. Una clave de idempotencia repetida devuelve la compra ya creada (`creada:false`).
 * Proveedor + número repetidos (vivos) lanzan ErrorCompras 'numero_duplicado'.
 */
export async function crearCompra(
  tenantId: string,
  datos: NuevaCompra,
): Promise<{ id: string; creada: boolean }> {
  const db = getDb()
  try {
    return await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(compras)
        .values({
          tenantId,
          cuentaId: datos.cuentaId,
          proveedorAlegraId: datos.proveedorAlegraId,
          proveedorNombre: datos.proveedorNombre,
          proveedorCuit: datos.proveedorCuit ?? null,
          numeroFactura: datos.numeroFactura,
          fecha: datos.fecha,
          vencimiento: datos.vencimiento,
          observaciones: datos.observaciones ?? null,
          almacenId: datos.almacenId,
          estado: "creando",
          netoCentavos: datos.netoCentavos,
          ivaCentavos: datos.ivaCentavos,
          percepcionesCentavos: datos.percepcionesCentavos,
          totalCentavos: datos.totalCentavos,
          idempotencyKey: datos.idempotencyKey,
          creadaPor: datos.creadaPor ?? null,
        })
        .returning({ id: compras.id })
      if (datos.items.length > 0) {
        await tx.insert(compraItems).values(
          datos.items.map((it, i) => ({
            tenantId,
            compraId: c.id,
            orden: i + 1,
            alegraId: it.alegraId,
            itemIdCuenta: it.itemIdCuenta,
            codigo: it.codigo ?? null,
            nombre: it.nombre,
            cantidadPedida: it.cantidadPedida,
            costoUnitarioCentavos: it.costoUnitarioCentavos,
            ivaPorcentaje: it.ivaPorcentaje,
            taxAlegraId: it.taxAlegraId,
            netoE5: it.netoE5,
          })),
        )
      }
      if (datos.percepciones.length > 0) {
        await tx.insert(compraPercepciones).values(
          datos.percepciones.map((p) => ({
            tenantId,
            compraId: c.id,
            alegraPerceptionId: p.alegraPerceptionId,
            nombre: p.nombre,
            importeCentavos: p.importeCentavos,
            numeroCertificado: p.numeroCertificado ?? null,
          })),
        )
      }
      return { id: c.id, creada: true }
    })
  } catch (e) {
    if (esViolacionUnica(e, "compras_tenant_idempotency_uniq")) {
      const [previa] = await db
        .select({ id: compras.id })
        .from(compras)
        .where(and(eq(compras.tenantId, tenantId), eq(compras.idempotencyKey, datos.idempotencyKey)))
      if (previa) return { id: previa.id, creada: false }
    }
    if (esViolacionUnica(e, "compras_proveedor_numero_uniq")) {
      throw new ErrorCompras(
        "numero_duplicado",
        "Ya existe una compra de este proveedor con ese número de factura en la cuenta seleccionada.",
      )
    }
    throw e
  }
}

/**
 * Descarta una compra que quedó en 'creando' sin bill en Alegra (el POST fue rechazado). Sólo borra
 * filas en 'creando' y sin `alegra_bill_id`; las hijas caen en cascada. Libera la clave de
 * idempotencia y el proveedor + número para reintentar.
 */
export async function descartarCompraCreando(tenantId: string, compraId: string): Promise<boolean> {
  const borradas = await getDb()
    .delete(compras)
    .where(
      and(
        eq(compras.tenantId, tenantId),
        eq(compras.id, compraId),
        eq(compras.estado, "creando"),
        sql`${compras.alegraBillId} IS NULL`,
      ),
    )
    .returning({ id: compras.id })
  return borradas.length > 0
}

/** La compra del tenant con esa clave de idempotencia (la de la creación), o null. */
export async function compraPorIdempotencia(tenantId: string, clave: string): Promise<CompraFila | null> {
  const [c] = await getDb()
    .select()
    .from(compras)
    .where(and(eq(compras.tenantId, tenantId), eq(compras.idempotencyKey, clave)))
  return c ?? null
}

export interface DetalleNuevo {
  netoCentavos: number
  ivaCentavos: number
  percepcionesCentavos: number
  totalCentavos: number
  items: NuevoItem[]
  percepciones: NuevaPercepcion[]
}

/**
 * Reemplaza los ítems, las percepciones y los totales de una compra SIN recepciones (edición antes
 * de recibir). Correr dentro de `conLockCompra`.
 */
export async function reemplazarDetalle(tx: Tx, tenantId: string, compraId: string, d: DetalleNuevo): Promise<void> {
  await tx.delete(compraItems).where(and(eq(compraItems.tenantId, tenantId), eq(compraItems.compraId, compraId)))
  await tx.delete(compraPercepciones).where(and(eq(compraPercepciones.tenantId, tenantId), eq(compraPercepciones.compraId, compraId)))
  await tx.insert(compraItems).values(
    d.items.map((it, i) => ({
      tenantId,
      compraId,
      orden: i + 1,
      alegraId: it.alegraId,
      itemIdCuenta: it.itemIdCuenta,
      codigo: it.codigo ?? null,
      nombre: it.nombre,
      cantidadPedida: it.cantidadPedida,
      costoUnitarioCentavos: it.costoUnitarioCentavos,
      ivaPorcentaje: it.ivaPorcentaje,
      taxAlegraId: it.taxAlegraId,
      netoE5: it.netoE5,
    })),
  )
  if (d.percepciones.length > 0) {
    await tx.insert(compraPercepciones).values(
      d.percepciones.map((p) => ({
        tenantId,
        compraId,
        alegraPerceptionId: p.alegraPerceptionId,
        nombre: p.nombre,
        importeCentavos: p.importeCentavos,
        numeroCertificado: p.numeroCertificado ?? null,
      })),
    )
  }
  await tx
    .update(compras)
    .set({
      netoCentavos: d.netoCentavos,
      ivaCentavos: d.ivaCentavos,
      percepcionesCentavos: d.percepcionesCentavos,
      totalCentavos: d.totalCentavos,
      updatedAt: new Date(),
    })
    .where(and(eq(compras.tenantId, tenantId), eq(compras.id, compraId)))
}

export async function obtenerCompra(tenantId: string, id: string, db: DbOTx = getDb()): Promise<CompraCompleta | null> {
  const [c] = await db.select().from(compras).where(and(eq(compras.tenantId, tenantId), eq(compras.id, id)))
  if (!c) return null
  const [items, percepcionesDetalle, recepciones] = await Promise.all([
    db.select().from(compraItems).where(and(eq(compraItems.tenantId, tenantId), eq(compraItems.compraId, id))).orderBy(compraItems.orden),
    db.select().from(compraPercepciones).where(and(eq(compraPercepciones.tenantId, tenantId), eq(compraPercepciones.compraId, id))),
    db
      .select()
      .from(compraRecepciones)
      .where(and(eq(compraRecepciones.tenantId, tenantId), eq(compraRecepciones.compraId, id)))
      .orderBy(compraRecepciones.secuencia),
  ])
  return { ...c, items, percepcionesDetalle, recepciones }
}

export interface FiltroListado {
  estado?: EstadoCompra
  cuentaId?: string
  /** Busca en proveedor y número de factura. */
  q?: string
  limit?: number
  offset?: number
}

export const LISTADO_LIMITE_MAX = 100

export async function listarCompras(tenantId: string, filtro: FiltroListado = {}): Promise<CompraFila[]> {
  const limit = Math.min(Math.max(filtro.limit ?? 25, 1), LISTADO_LIMITE_MAX)
  const cond = [eq(compras.tenantId, tenantId)]
  if (filtro.estado) cond.push(eq(compras.estado, filtro.estado))
  if (filtro.cuentaId) cond.push(eq(compras.cuentaId, filtro.cuentaId))
  const q = filtro.q?.trim()
  if (q) {
    const patron = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    cond.push(or(ilike(compras.proveedorNombre, patron), ilike(compras.numeroFactura, patron))!)
  }
  return getDb()
    .select()
    .from(compras)
    .where(and(...cond))
    .orderBy(desc(compras.createdAt))
    .limit(limit)
    .offset(Math.max(filtro.offset ?? 0, 0))
}

/**
 * Transacción corta sobre UNA compra del tenant con lock advisory: las operaciones sobre la misma
 * compra se serializan. Lanza ErrorCompras 'no_encontrada' si no existe (o es de otro tenant).
 */
export async function conLockCompra<T>(
  tenantId: string,
  compraId: string,
  fn: (tx: Tx, compra: CompraFila) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`compra:${tenantId}:${compraId}`}))`)
    const [c] = await tx.select().from(compras).where(and(eq(compras.tenantId, tenantId), eq(compras.id, compraId)))
    if (!c) throw new ErrorCompras("no_encontrada", "La compra no existe.")
    return fn(tx, c)
  })
}

export interface PatchCompra {
  estado?: EstadoCompra
  alegraBillId?: string | null
  desincronizada?: boolean
  snapshot?: unknown
  snapshotHash?: string | null
  anuladaAt?: Date | null
  cierreEstado?: string | null
  cierreIdempotencyKey?: string | null
  cierreNcNumero?: string | null
  cierreImporteCentavos?: number | null
  cierreAlegraId?: string | null
  cierreMotivo?: string | null
  cierreAt?: Date | null
}

export async function actualizarCompra(tx: DbOTx, tenantId: string, compraId: string, patch: PatchCompra): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v
  await tx.update(compras).set(set).where(and(eq(compras.tenantId, tenantId), eq(compras.id, compraId)))
}

export interface NuevaRecepcion {
  idempotencyKey: string
  remito?: string | null
  fecha: string
  notas?: string | null
  lineasAntesHash: string
  lineasEsperadasHash: string
  totalAntesCentavos: number
  creadaPor?: string | null
  /** Cantidades de ESTA recepción (milésimas como texto "1.500") por ítem de la compra. */
  items: { compraItemId: string; cantidad: string; montoNetoE5: number }[]
}

/**
 * Inserta una recepción 'pendiente' (la intención, antes de tocar Alegra). Debe correr dentro de
 * `conLockCompra`. Con la misma clave de idempotencia devuelve la existente (`creada:false`); si ya
 * hay otra recepción en vuelo lanza ErrorCompras 'recepcion_en_curso'.
 */
export async function insertarRecepcion(
  tx: Tx,
  tenantId: string,
  compraId: string,
  datos: NuevaRecepcion,
): Promise<{ id: string; secuencia: number; creada: boolean }> {
  const [previa] = await tx
    .select({ id: compraRecepciones.id, secuencia: compraRecepciones.secuencia })
    .from(compraRecepciones)
    .where(
      and(
        eq(compraRecepciones.tenantId, tenantId),
        eq(compraRecepciones.compraId, compraId),
        eq(compraRecepciones.idempotencyKey, datos.idempotencyKey),
      ),
    )
  if (previa) return { ...previa, creada: false }

  const [{ max }] = await tx
    .select({ max: sql<number>`coalesce(max(${compraRecepciones.secuencia}), 0)::int` })
    .from(compraRecepciones)
    .where(and(eq(compraRecepciones.tenantId, tenantId), eq(compraRecepciones.compraId, compraId)))
  const secuencia = max + 1
  // SAVEPOINT: una violación del índice de recepción en vuelo no debe abortar la transacción.
  try {
    const [r] = await tx.transaction(async (sp) =>
      sp
        .insert(compraRecepciones)
        .values({
          tenantId,
          compraId,
          secuencia,
          estado: "pendiente",
          idempotencyKey: datos.idempotencyKey,
          remito: datos.remito ?? null,
          fecha: datos.fecha,
          notas: datos.notas ?? null,
          lineasAntesHash: datos.lineasAntesHash,
          lineasEsperadasHash: datos.lineasEsperadasHash,
          totalAntesCentavos: datos.totalAntesCentavos,
          creadaPor: datos.creadaPor ?? null,
        })
        .returning({ id: compraRecepciones.id }),
    )
    await tx.insert(compraRecepcionItems).values(
      datos.items.map((i) => ({
        tenantId,
        recepcionId: r.id,
        compraItemId: i.compraItemId,
        cantidad: i.cantidad,
        montoNetoE5: i.montoNetoE5,
      })),
    )
    return { id: r.id, secuencia, creada: true }
  } catch (e) {
    if (esViolacionUnica(e, "compra_recepciones_en_vuelo_uniq")) {
      throw new ErrorCompras(
        "recepcion_en_curso",
        "Hay otra recepción de esta compra en curso. Espere a que termine o verifíquela en Alegra.",
      )
    }
    throw e
  }
}

export interface PatchRecepcion {
  estado?: "pendiente" | "aplicada" | "fallida" | "incierta"
  motivoFallo?: string | null
  totalDespuesCentavos?: number | null
  aplicadaAt?: Date | null
}

export async function actualizarRecepcion(
  tx: DbOTx,
  tenantId: string,
  recepcionId: string,
  patch: PatchRecepcion,
): Promise<void> {
  const set: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v
  if (Object.keys(set).length === 0) return
  await tx
    .update(compraRecepciones)
    .set(set)
    .where(and(eq(compraRecepciones.tenantId, tenantId), eq(compraRecepciones.id, recepcionId)))
}

/** Lo recibido por ítem según la VERDAD: Σ de las recepciones 'aplicada'. */
export async function recibidoAplicadoPorItem(
  tenantId: string,
  compraId: string,
  db: DbOTx = getDb(),
): Promise<Map<string, string>> {
  const filas = await db
    .select({
      compraItemId: compraRecepcionItems.compraItemId,
      total: sql<string>`sum(${compraRecepcionItems.cantidad})::text`,
    })
    .from(compraRecepcionItems)
    .innerJoin(
      compraRecepciones,
      and(
        eq(compraRecepciones.tenantId, compraRecepcionItems.tenantId),
        eq(compraRecepciones.id, compraRecepcionItems.recepcionId),
      ),
    )
    .where(
      and(
        eq(compraRecepciones.tenantId, tenantId),
        eq(compraRecepciones.compraId, compraId),
        eq(compraRecepciones.estado, "aplicada"),
      ),
    )
    .groupBy(compraRecepcionItems.compraItemId)
  return new Map(filas.map((f) => [f.compraItemId, f.total]))
}

/**
 * Recalcula la caché `cantidad_recibida` de TODOS los ítems de la compra desde las recepciones
 * aplicadas (los que no tienen ninguna quedan en 0). Llamar dentro de la transacción que marca
 * la recepción como 'aplicada'.
 */
export async function recalcularRecibido(tx: Tx, tenantId: string, compraId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE compra_items ci
    SET cantidad_recibida = COALESCE((
      SELECT sum(ri.cantidad)
      FROM compra_recepcion_items ri
      JOIN compra_recepciones r ON r.tenant_id = ri.tenant_id AND r.id = ri.recepcion_id
      WHERE r.tenant_id = ${tenantId} AND r.compra_id = ${compraId} AND r.estado = 'aplicada'
        AND ri.compra_item_id = ci.id
    ), 0)
    WHERE ci.tenant_id = ${tenantId} AND ci.compra_id = ${compraId}
  `)
}

/** Recepciones de la compra que no terminaron (para reconciliar). */
export async function recepcionesEnVuelo(tenantId: string, compraId: string): Promise<RecepcionFila[]> {
  return getDb()
    .select()
    .from(compraRecepciones)
    .where(
      and(
        eq(compraRecepciones.tenantId, tenantId),
        eq(compraRecepciones.compraId, compraId),
        inArray(compraRecepciones.estado, ["pendiente", "incierta"]),
      ),
    )
}
