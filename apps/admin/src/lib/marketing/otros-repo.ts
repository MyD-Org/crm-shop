// src/lib/marketing/otros-repo.ts
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { marketingInteracciones, marketingMaterial, marketingMetricas, marketingMusica, marketingSolicitudes } from "@/db/schema"
import { urlPublicaFoto } from "@/lib/shop-media"
import { obtenerPieza, transicionar } from "./piezas-repo"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Solicitudes (cola de la rutina) ─────────────────────────────────────────────
export type TipoSolicitud = "plan_semana" | "cambios" | "ajuste_reparto"
export interface SolicitudDto { id: string; tipo: TipoSolicitud; piezaId: string | null; nota: string; estado: string; resultado: string; createdAt: string; resueltaAt: string | null }

function solicitudDto(f: typeof marketingSolicitudes.$inferSelect): SolicitudDto {
  return { id: f.id, tipo: f.tipo as TipoSolicitud, piezaId: f.piezaId, nota: f.nota, estado: f.estado, resultado: f.resultado, createdAt: f.createdAt.toISOString(), resueltaAt: f.resueltaAt?.toISOString() ?? null }
}

export async function crearSolicitud(tenantId: string, tipo: TipoSolicitud, opciones: { piezaId?: string; nota?: string } = {}): Promise<SolicitudDto> {
  const [f] = await getDb().insert(marketingSolicitudes).values({ tenantId, tipo, piezaId: opciones.piezaId ?? null, nota: opciones.nota ?? "" }).returning()
  return solicitudDto(f)
}

export async function listarSolicitudes(tenantId: string, estado: "pendiente" | "resuelta" | "fallida"): Promise<SolicitudDto[]> {
  const filas = await getDb().select().from(marketingSolicitudes).where(and(eq(marketingSolicitudes.tenantId, tenantId), eq(marketingSolicitudes.estado, estado))).orderBy(asc(marketingSolicitudes.createdAt))
  return filas.map(solicitudDto)
}

export async function hayPendiente(tenantId: string, tipo: TipoSolicitud, piezaId: string): Promise<boolean> {
  return (await solicitudPendiente(tenantId, tipo, piezaId)) !== null
}

/** Solicitud pendiente del tenant de ese tipo (y de esa pieza, si se indica); null si no hay. */
export async function solicitudPendiente(tenantId: string, tipo: TipoSolicitud, piezaId?: string): Promise<SolicitudDto | null> {
  if (piezaId !== undefined && !UUID_RE.test(piezaId)) return null
  const [f] = await getDb()
    .select()
    .from(marketingSolicitudes)
    .where(
      and(
        eq(marketingSolicitudes.tenantId, tenantId),
        eq(marketingSolicitudes.tipo, tipo),
        eq(marketingSolicitudes.estado, "pendiente"),
        ...(piezaId !== undefined ? [eq(marketingSolicitudes.piezaId, piezaId)] : []),
      ),
    )
    .orderBy(asc(marketingSolicitudes.createdAt))
    .limit(1)
  return f ? solicitudDto(f) : null
}

export async function resolverSolicitud(tenantId: string, id: string, ok: boolean, resultado = ""): Promise<SolicitudDto | null> {
  if (!UUID_RE.test(id)) return null
  const [f] = await getDb()
    .update(marketingSolicitudes)
    .set({ estado: ok ? "resuelta" : "fallida", resultado, resueltaAt: new Date() })
    .where(and(eq(marketingSolicitudes.tenantId, tenantId), eq(marketingSolicitudes.id, id), eq(marketingSolicitudes.estado, "pendiente")))
    .returning()
  return f ? solicitudDto(f) : null
}

// ── Material ────────────────────────────────────────────────────────────────────
export interface MaterialDto { id: string; piezaId: string | null; archivoKey: string; url: string | null; tipo: "video" | "foto"; contentType: string; bytes: number; createdAt: string }

function materialDto(f: typeof marketingMaterial.$inferSelect): MaterialDto {
  return { id: f.id, piezaId: f.piezaId, archivoKey: f.archivoKey, url: urlPublicaFoto(f.archivoKey), tipo: f.tipo as "video" | "foto", contentType: f.contentType, bytes: f.bytes, createdAt: f.createdAt.toISOString() }
}

export async function registrarMaterial(
  tenantId: string,
  input: { piezaId: string | null; archivoKey: string; tipo: "video" | "foto"; contentType: string; bytes: number; subidoPor: string | null },
): Promise<MaterialDto> {
  const [f] = await getDb().insert(marketingMaterial).values({ tenantId, ...input }).returning()
  if (input.piezaId) {
    const pieza = await obtenerPieza(tenantId, input.piezaId)
    if (pieza?.estado === "esperando_material") {
      const r = await transicionar(tenantId, input.piezaId, "borrador", "usuario", { nombreActor: "material", nota: "material subido" })
      // El archivo ya quedó registrado: no se falla la subida, pero se deja rastro de que la pieza no avanzó.
      if (!r.ok) console.warn(`[marketing] material subido pero la pieza ${input.piezaId} no pasó a borrador: ${r.code}`)
    }
  }
  return materialDto(f)
}

export async function listarMaterial(tenantId: string, piezaId: string): Promise<MaterialDto[]> {
  if (!UUID_RE.test(piezaId)) return []
  const filas = await getDb().select().from(marketingMaterial).where(and(eq(marketingMaterial.tenantId, tenantId), eq(marketingMaterial.piezaId, piezaId))).orderBy(asc(marketingMaterial.createdAt))
  return filas.map(materialDto)
}

// ── Música ──────────────────────────────────────────────────────────────────────
export interface MusicaDto { id: string; titulo: string; autor: string; licencia: string; contentId: boolean; bpm: number; dropSeg: number; duracionSeg: number; url: string | null }

export async function listarMusica(tenantId: string): Promise<MusicaDto[]> {
  const filas = await getDb().select().from(marketingMusica).where(eq(marketingMusica.tenantId, tenantId)).orderBy(asc(marketingMusica.titulo))
  return filas.map((f) => ({ id: f.id, titulo: f.titulo, autor: f.autor, licencia: f.licencia, contentId: f.contentId, bpm: Number(f.bpm), dropSeg: Number(f.dropSeg), duracionSeg: Number(f.duracionSeg), url: urlPublicaFoto(f.archivoKey) }))
}

// ── Métricas ────────────────────────────────────────────────────────────────────
export interface MetricaDto { ambito: string; refId: string; fecha: string; metricas: Record<string, number> }

export async function guardarMetricas(
  tenantId: string,
  filas: { ambito: "pieza" | "cuenta_ig" | "ficha_google"; refId: string; fecha: string; metricas: Record<string, number> }[],
): Promise<number> {
  if (filas.length === 0) return 0
  // Una misma clave repetida en el lote rompería el ON CONFLICT (no puede afectar la fila dos veces): gana la última.
  const porClave = new Map<string, (typeof filas)[number]>()
  for (const f of filas) porClave.set(`${f.ambito}\u0000${f.refId}\u0000${f.fecha}`, f)
  const unicas = [...porClave.values()]
  await getDb()
    .insert(marketingMetricas)
    .values(unicas.map((f) => ({ tenantId, ...f })))
    .onConflictDoUpdate({
      target: [marketingMetricas.tenantId, marketingMetricas.ambito, marketingMetricas.refId, marketingMetricas.fecha],
      set: { metricas: sql`excluded.metricas`, updatedAt: new Date() },
    })
  return unicas.length
}

export async function listarMetricas(tenantId: string, desde: string, hasta: string): Promise<MetricaDto[]> {
  const filas = await getDb()
    .select()
    .from(marketingMetricas)
    .where(and(eq(marketingMetricas.tenantId, tenantId), gte(marketingMetricas.fecha, desde), lte(marketingMetricas.fecha, hasta)))
    .orderBy(asc(marketingMetricas.fecha))
  return filas.map((f) => ({ ambito: f.ambito, refId: f.refId, fecha: f.fecha, metricas: f.metricas }))
}

// ── Interacciones ───────────────────────────────────────────────────────────────
export interface NuevaInteraccion {
  origen: "comentario" | "dm" | "mencion" | "resena_google"
  externoId: string
  piezaId?: string | null
  autor: string
  texto: string
  categoria: "consulta" | "asesoramiento" | "elogio" | "queja" | "spam" | "otro"
  sentimiento: "positivo" | "neutro" | "negativo"
  respuestaSugerida: string
}
export interface InteraccionDto extends NuevaInteraccion { id: string; respuestaFinal: string | null; estado: string; createdAt: string }

function interaccionDto(f: typeof marketingInteracciones.$inferSelect): InteraccionDto {
  return {
    id: f.id,
    origen: f.origen as NuevaInteraccion["origen"],
    externoId: f.externoId,
    piezaId: f.piezaId,
    autor: f.autor,
    texto: f.texto,
    categoria: f.categoria as NuevaInteraccion["categoria"],
    sentimiento: f.sentimiento as NuevaInteraccion["sentimiento"],
    respuestaSugerida: f.respuestaSugerida,
    respuestaFinal: f.respuestaFinal,
    estado: f.estado,
    createdAt: f.createdAt.toISOString(),
  }
}

export async function guardarInteraccion(tenantId: string, input: NuevaInteraccion): Promise<InteraccionDto> {
  const db = getDb()
  // Idempotente por (origen, externo_id): el webhook de Meta reintenta. Si ya existe, no se toca.
  await db.insert(marketingInteracciones).values({ tenantId, ...input, piezaId: input.piezaId ?? null }).onConflictDoNothing()
  const [f] = await db
    .select()
    .from(marketingInteracciones)
    .where(and(eq(marketingInteracciones.tenantId, tenantId), eq(marketingInteracciones.origen, input.origen), eq(marketingInteracciones.externoId, input.externoId)))
  return interaccionDto(f)
}

export async function listarInteracciones(tenantId: string, estado?: string): Promise<InteraccionDto[]> {
  const condiciones = [eq(marketingInteracciones.tenantId, tenantId)]
  if (estado) condiciones.push(eq(marketingInteracciones.estado, estado))
  const filas = await getDb().select().from(marketingInteracciones).where(and(...condiciones)).orderBy(desc(marketingInteracciones.createdAt)).limit(200)
  return filas.map(interaccionDto)
}

const DESTINO: Record<"aprobar" | "ocultar" | "ignorar" | "marcar_respondida", string> = {
  aprobar: "aprobada",
  ocultar: "oculta",
  ignorar: "ignorada",
  marcar_respondida: "respondida",
}

// Estados desde los que cada acción es válida: evita que un doble clic o una acción tardía regrese el estado
// (respondida → oculta) o pise la respuesta editada al volver a aprobar.
const DESDE: Record<"aprobar" | "ocultar" | "ignorar" | "marcar_respondida", string[]> = {
  aprobar: ["pendiente"],
  ocultar: ["pendiente"],
  ignorar: ["pendiente"],
  marcar_respondida: ["aprobada"],
}

export async function actualizarInteraccion(
  tenantId: string,
  id: string,
  accion: "aprobar" | "ocultar" | "ignorar" | "marcar_respondida",
  respuesta?: string,
): Promise<InteraccionDto | null> {
  if (!UUID_RE.test(id)) return null
  const [f] = await getDb()
    .update(marketingInteracciones)
    .set({
      estado: DESTINO[accion],
      ...(accion === "aprobar" ? { respuestaFinal: respuesta?.trim() || sql`${marketingInteracciones.respuestaSugerida}` } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(marketingInteracciones.tenantId, tenantId), eq(marketingInteracciones.id, id), inArray(marketingInteracciones.estado, DESDE[accion])))
    .returning()
  return f ? interaccionDto(f) : null
}

export async function obtenerInteraccion(tenantId: string, id: string): Promise<InteraccionDto | null> {
  if (!UUID_RE.test(id)) return null
  const [f] = await getDb().select().from(marketingInteracciones).where(and(eq(marketingInteracciones.tenantId, tenantId), eq(marketingInteracciones.id, id)))
  return f ? interaccionDto(f) : null
}
