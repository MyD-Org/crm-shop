import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { metodosEnvio, metodosEnvioLocalidades, metodosEnvioZonaEntradas, metodosEnvioZonas } from "@/db/schema"
import { PROVINCIAS } from "@/lib/provincias"
import { claveProvinciaZona } from "@/lib/sucursales-zona"
import { claveTexto } from "@/lib/texto-clave"
import type { Bbox, Geometria } from "@/lib/geo-poligono"
import type { LocalidadAtendida, MetodoEnvio } from "@/lib/envio-zona"
import type { GeoLocalidad } from "@/lib/metodos-envio-localidades"
import type { MetodoEnvioValidado } from "@/lib/metodos-envio-validacion"

// Acceso a datos de los métodos de envío por zona (change `envio-por-zona-con-tarifa`, rebanada A).
// TODO filtra por `tenantId` (el del guard, nunca el del body): un método de otro tenant se comporta
// igual que uno inexistente (not_found). Guardar es un REEMPLAZO COMPLETO de método + zonas +
// geometrías + entradas + localidades en UNA transacción, con un lock por tenant. Las zonas que
// vuelven con su `id` lo conservan. Los errores viajan en usted.

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]

export interface EntradaDto {
  tipo: "georef" | "cp"
  valor: string
  etiqueta: string
}

export interface ZonaDto {
  id: string
  nombre: string
  precio: number
  orden: number
  activa: boolean
  geometria: Geometria
  entradas: EntradaDto[]
}

export interface LocalidadDto {
  georefId: string
  etiqueta: string
  abreviaturas: string[]
  centro: { lat: number; lon: number } | null
  bbox: Bbox | null
}

export interface MetodoEnvioDto {
  id: string
  slug: string
  nombre: string
  activo: boolean
  orden: number
  provincia: string
  provinciaClave: string
  sucursalOrigen: string | null
  diasOperativos: number[]
  horaCorte: string
  margenMin: number
  promesa: string
  avisoFeriados: string
  gratisAplica: boolean
  itemAlegraId: string | null
  itemAlegraIva: number
  zonas: ZonaDto[]
  localidades: LocalidadDto[]
}

/** Lo que se guarda: el método validado, con centro/bbox de las localidades si se pudieron obtener. */
export type MetodoParaGuardar = Omit<MetodoEnvioValidado, "localidades"> & {
  localidades: (MetodoEnvioValidado["localidades"][number] & Partial<GeoLocalidad>)[]
}

export type ResultadoMetodo =
  | { kind: "ok"; metodo: MetodoEnvioDto }
  | { kind: "conflict"; campo: string; error: string }
  | { kind: "not_found" }

export type ResultadoBorradoMetodo = { kind: "ok" } | { kind: "conflict"; error: string } | { kind: "not_found" }

const MSG_SLUG = "Ya existe un método con ese identificador."
const MSG_CONCURRENCIA = "Otro usuario modificó los métodos de envío al mismo tiempo. Inténtelo nuevamente."

function codigoPg(err: unknown): string | undefined {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  return undefined
}

async function bloquearTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`metodos-envio:${tenantId}`}))`)
}

/** "Mar del Plata (General Pueyrredón) — Buenos Aires" → clave de "Mar del Plata". */
function nombreNormDeEtiqueta(etiqueta: string): string {
  const nombre = etiqueta.split("—")[0].replace(/\([^)]*\)/g, "")
  return claveTexto(nombre)
}

const num = (v: string | null): number | null => (v === null ? null : Number(v))
const aNumeric = (n: number): string => n.toFixed(6)

interface Cargado {
  dto: MetodoEnvioDto
  /** Para los módulos puros: nombre normalizado de cada entrada georef y de cada localidad. */
  entradaNombreNorm: Map<string, string>
  localidadNombreNorm: Map<string, string>
}

async function cargar(tenantId: string, soloActivos: boolean): Promise<Cargado[]> {
  const db = getDb()
  const where = soloActivos
    ? and(eq(metodosEnvio.tenantId, tenantId), eq(metodosEnvio.activo, true))
    : eq(metodosEnvio.tenantId, tenantId)
  const metodos = await db.select().from(metodosEnvio).where(where).orderBy(asc(metodosEnvio.orden), asc(metodosEnvio.nombre))
  if (metodos.length === 0) return []
  const ids = metodos.map((m) => m.id)
  const [zonas, entradas, localidades] = await Promise.all([
    db.select().from(metodosEnvioZonas).where(inArray(metodosEnvioZonas.metodoId, ids)).orderBy(asc(metodosEnvioZonas.orden), asc(metodosEnvioZonas.nombre)),
    db.select().from(metodosEnvioZonaEntradas).where(inArray(metodosEnvioZonaEntradas.metodoId, ids)).orderBy(asc(metodosEnvioZonaEntradas.tipo), asc(metodosEnvioZonaEntradas.valor)),
    db.select().from(metodosEnvioLocalidades).where(inArray(metodosEnvioLocalidades.metodoId, ids)).orderBy(asc(metodosEnvioLocalidades.etiqueta)),
  ])
  return metodos.map((m): Cargado => {
    const entradaNombreNorm = new Map<string, string>()
    const zonasDto = zonas
      .filter((z) => z.metodoId === m.id)
      .map((z): ZonaDto => ({
        id: z.id,
        nombre: z.nombre,
        precio: Number(z.precio),
        orden: z.orden,
        activa: z.activa,
        geometria: z.geometria as Geometria,
        entradas: entradas
          .filter((e) => e.zonaId === z.id)
          .map((e) => {
            entradaNombreNorm.set(`${e.zonaId}:${e.tipo}:${e.valor}`, e.nombreNorm)
            return { tipo: e.tipo as "georef" | "cp", valor: e.valor, etiqueta: e.etiqueta }
          }),
      }))
    const localidadNombreNorm = new Map<string, string>()
    const localidadesDto = localidades
      .filter((l) => l.metodoId === m.id)
      .map((l): LocalidadDto => {
        localidadNombreNorm.set(l.georefId, l.nombreNorm)
        const [sur, oeste, norte, este] = [num(l.bboxSur), num(l.bboxOeste), num(l.bboxNorte), num(l.bboxEste)]
        const lat = num(l.centroLat)
        const lon = num(l.centroLon)
        return {
          georefId: l.georefId,
          etiqueta: l.etiqueta,
          abreviaturas: l.abreviaturas,
          centro: lat !== null && lon !== null ? { lat, lon } : null,
          bbox: sur !== null && oeste !== null && norte !== null && este !== null ? { sur, oeste, norte, este } : null,
        }
      })
    return {
      entradaNombreNorm,
      localidadNombreNorm,
      dto: {
        id: m.id,
        slug: m.slug,
        nombre: m.nombre,
        activo: m.activo,
        orden: m.orden,
        provincia: PROVINCIAS.find((p) => claveProvinciaZona(p) === m.provinciaClave) ?? m.provinciaClave,
        provinciaClave: m.provinciaClave,
        sucursalOrigen: m.sucursalOrigen,
        diasOperativos: [...m.diasOperativos].sort((a, b) => a - b),
        horaCorte: m.horaCorte.slice(0, 5),
        margenMin: m.margenMin,
        promesa: m.promesa,
        avisoFeriados: m.avisoFeriados,
        gratisAplica: m.gratisAplica,
        itemAlegraId: m.itemAlegraId,
        itemAlegraIva: Number(m.itemAlegraIva),
        zonas: zonasDto,
        localidades: localidadesDto,
      },
    }
  })
}

export async function listarMetodos(tenantId: string): Promise<MetodoEnvioDto[]> {
  return (await cargar(tenantId, false)).map((c) => c.dto)
}

function aMetodoPuro({ dto, entradaNombreNorm, localidadNombreNorm }: Cargado): MetodoEnvio {
  return {
    id: dto.id,
    slug: dto.slug,
    nombre: dto.nombre,
    tipo: "tarifa_zona",
    activo: dto.activo,
    orden: dto.orden,
    provinciaClave: dto.provinciaClave,
    sucursalOrigen: dto.sucursalOrigen,
    diasOperativos: dto.diasOperativos,
    horaCorte: dto.horaCorte,
    margenMin: dto.margenMin,
    promesa: dto.promesa,
    avisoFeriados: dto.avisoFeriados,
    gratisAplica: dto.gratisAplica,
    itemAlegraId: dto.itemAlegraId,
    itemAlegraIva: dto.itemAlegraIva,
    zonas: dto.zonas.map((z) => ({
      id: z.id,
      nombre: z.nombre,
      precio: z.precio,
      orden: z.orden,
      activa: z.activa,
      geometria: z.geometria,
      entradas: z.entradas.map((e) => ({ ...e, nombreNorm: entradaNombreNorm.get(`${z.id}:${e.tipo}:${e.valor}`) })),
    })),
    localidades: dto.localidades.map((l): LocalidadAtendida => ({
      georefId: l.georefId,
      etiqueta: l.etiqueta,
      nombreNorm: localidadNombreNorm.get(l.georefId),
      abreviaturas: l.abreviaturas,
      centro: l.centro,
      bbox: l.bbox,
    })),
  }
}

/** Métodos activos en la forma que consumen los módulos puros (`resolverZona`, `estimarPorLocalidad`). */
export async function leerMetodosActivos(tenantId: string): Promise<MetodoEnvio[]> {
  return (await cargar(tenantId, true)).map(aMetodoPuro)
}

/** Un método del tenant (activo o no) en la forma de los módulos puros; null si no existe o es de otro tenant. */
export async function leerMetodoPuro(tenantId: string, id: string): Promise<MetodoEnvio | null> {
  const c = (await cargar(tenantId, false)).find((x) => x.dto.id === id)
  return c ? aMetodoPuro(c) : null
}

/** Escribe zonas, entradas y localidades de un método (ya sin las anteriores). */
async function escribirHijos(
  tx: Tx,
  metodoId: string,
  m: MetodoParaGuardar,
  geoPrevia: Map<string, GeoLocalidad>,
): Promise<void> {
  for (const z of m.zonas) {
    const [fila] = await tx
      .insert(metodosEnvioZonas)
      .values({
        ...(z.id && { id: z.id }),
        metodoId,
        nombre: z.nombre,
        precio: z.precio.toFixed(2),
        orden: z.orden,
        activa: z.activa,
        geometria: z.geometria as number[][][][],
      })
      .returning({ id: metodosEnvioZonas.id })
    if (z.entradas.length > 0) {
      await tx.insert(metodosEnvioZonaEntradas).values(
        z.entradas.map((e) => ({
          zonaId: fila.id,
          metodoId,
          tipo: e.tipo,
          valor: e.valor,
          etiqueta: e.etiqueta,
          nombreNorm: e.tipo === "georef" ? nombreNormDeEtiqueta(e.etiqueta) : claveTexto(e.valor),
        })),
      )
    }
  }
  if (m.localidades.length > 0) {
    await tx.insert(metodosEnvioLocalidades).values(
      m.localidades.map((l) => {
        // Si ahora no se pudo obtener el dato (Georef/Nominatim caídos), queda el que ya había.
        const previa = geoPrevia.get(l.georefId)
        const centro = l.centro ?? previa?.centro ?? null
        const bbox = l.bbox ?? previa?.bbox ?? null
        return {
          metodoId,
          georefId: l.georefId,
          etiqueta: l.etiqueta,
          nombreNorm: nombreNormDeEtiqueta(l.etiqueta),
          abreviaturas: l.abreviaturas,
          centroLat: centro ? aNumeric(centro.lat) : null,
          centroLon: centro ? aNumeric(centro.lon) : null,
          bboxSur: bbox ? aNumeric(bbox.sur) : null,
          bboxOeste: bbox ? aNumeric(bbox.oeste) : null,
          bboxNorte: bbox ? aNumeric(bbox.norte) : null,
          bboxEste: bbox ? aNumeric(bbox.este) : null,
        }
      }),
    )
  }
}

function columnasMetodo(m: MetodoParaGuardar) {
  return {
    slug: m.slug,
    nombre: m.nombre,
    activo: m.activo,
    orden: m.orden,
    provinciaClave: m.provinciaClave,
    sucursalOrigen: m.sucursalOrigen,
    diasOperativos: m.diasOperativos,
    horaCorte: m.horaCorte,
    margenMin: m.margenMin,
    promesa: m.promesa,
    avisoFeriados: m.avisoFeriados,
    gratisAplica: m.gratisAplica,
    itemAlegraId: m.itemAlegraId,
    itemAlegraIva: m.itemAlegraIva.toFixed(2),
  }
}

async function leerUno(tenantId: string, id: string): Promise<MetodoEnvioDto> {
  const m = (await cargar(tenantId, false)).find((c) => c.dto.id === id)
  if (!m) throw new Error("El método recién guardado no se encontró")
  return m.dto
}

export async function crearMetodo(tenantId: string, m: MetodoParaGuardar): Promise<ResultadoMetodo> {
  try {
    const id = await getDb().transaction(async (tx): Promise<string | null> => {
      await bloquearTenant(tx, tenantId)
      const [existente] = await tx
        .select({ id: metodosEnvio.id })
        .from(metodosEnvio)
        .where(and(eq(metodosEnvio.tenantId, tenantId), eq(metodosEnvio.slug, m.slug)))
      if (existente) return null
      const [fila] = await tx.insert(metodosEnvio).values({ ...columnasMetodo(m), tenantId }).returning({ id: metodosEnvio.id })
      await escribirHijos(tx, fila.id, m, new Map())
      return fila.id
    })
    if (!id) return { kind: "conflict", campo: "slug", error: MSG_SLUG }
    return { kind: "ok", metodo: await leerUno(tenantId, id) }
  } catch (err) {
    if (codigoPg(err) === "23505") return { kind: "conflict", campo: "slug", error: MSG_CONCURRENCIA }
    throw err
  }
}

export async function guardarMetodo(tenantId: string, id: string, m: MetodoParaGuardar): Promise<ResultadoMetodo> {
  try {
    const resultado = await getDb().transaction(async (tx): Promise<"ok" | "not_found" | "slug"> => {
      await bloquearTenant(tx, tenantId)
      const [actual] = await tx
        .select({ id: metodosEnvio.id })
        .from(metodosEnvio)
        .where(and(eq(metodosEnvio.tenantId, tenantId), eq(metodosEnvio.id, id)))
      if (!actual) return "not_found"
      const [otro] = await tx
        .select({ id: metodosEnvio.id })
        .from(metodosEnvio)
        .where(and(eq(metodosEnvio.tenantId, tenantId), eq(metodosEnvio.slug, m.slug)))
      if (otro && otro.id !== id) return "slug"

      const previas = await tx.select().from(metodosEnvioLocalidades).where(eq(metodosEnvioLocalidades.metodoId, id))
      const geoPrevia = new Map<string, GeoLocalidad>(
        previas.map((l) => {
          const lat = num(l.centroLat)
          const lon = num(l.centroLon)
          const [sur, oeste, norte, este] = [num(l.bboxSur), num(l.bboxOeste), num(l.bboxNorte), num(l.bboxEste)]
          return [
            l.georefId,
            {
              centro: lat !== null && lon !== null ? { lat, lon } : null,
              bbox: sur !== null && oeste !== null && norte !== null && este !== null ? { sur, oeste, norte, este } : null,
            },
          ]
        }),
      )

      await tx.update(metodosEnvio).set({ ...columnasMetodo(m), updatedAt: new Date() }).where(eq(metodosEnvio.id, id))
      // Las entradas caen en cascada con sus zonas.
      await tx.delete(metodosEnvioZonas).where(eq(metodosEnvioZonas.metodoId, id))
      await tx.delete(metodosEnvioLocalidades).where(eq(metodosEnvioLocalidades.metodoId, id))
      await escribirHijos(tx, id, m, geoPrevia)
      return "ok"
    })
    if (resultado === "not_found") return { kind: "not_found" }
    if (resultado === "slug") return { kind: "conflict", campo: "slug", error: MSG_SLUG }
    return { kind: "ok", metodo: await leerUno(tenantId, id) }
  } catch (err) {
    if (codigoPg(err) === "23505" && !/metodos_envio_zonas_metodo_nombre_uniq|entradas_metodo_tipo_valor/.test(String((err as Error).message) + String((err as { cause?: Error }).cause?.message ?? ""))) {
      return { kind: "conflict", campo: "slug", error: MSG_CONCURRENCIA }
    }
    throw err
  }
}

/** Sólo se elimina un método inactivo (el activo se desactiva primero, a propósito). */
export async function eliminarMetodo(tenantId: string, id: string): Promise<ResultadoBorradoMetodo> {
  return getDb().transaction(async (tx): Promise<ResultadoBorradoMetodo> => {
    await bloquearTenant(tx, tenantId)
    const [m] = await tx
      .select({ activo: metodosEnvio.activo })
      .from(metodosEnvio)
      .where(and(eq(metodosEnvio.tenantId, tenantId), eq(metodosEnvio.id, id)))
    if (!m) return { kind: "not_found" }
    if (m.activo) return { kind: "conflict", error: "Desactive el método antes de eliminarlo." }
    await tx.delete(metodosEnvio).where(eq(metodosEnvio.id, id))
    return { kind: "ok" }
  })
}
