// src/lib/marketing/piezas-repo.ts
// Acceso a marketing_piezas. Toda escritura de estado pasa por acá: valida la arista con
// puedeTransicionar, usa `where estado = de` (concurrencia optimista) y deja un evento.
import { isDeepStrictEqual } from "node:util"
import { and, asc, eq, gte, isNull, lt, notInArray, sql } from "drizzle-orm"
import { getDb, type Db } from "@/db"
import { marketingPiezaEventos, marketingPiezas, marketingSolicitudes, type AlertaPieza } from "@/db/schema"
import { urlPublicaFoto } from "@/lib/shop-media"
import { ESTADOS_EDITABLES, esEstadoPieza, puedeTransicionar, type ActorPieza, type EstadoPieza } from "./estados"
import { obtenerMarca } from "./marca-repo"
import { evaluarReglas, textosDePieza } from "./reglas"
import type { BriefGrabacion, Canal, Formato, Objetivo, PiezaDto, Produccion, Publico, Tema } from "./tipos"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface NuevaPieza {
  canal: Canal
  formato: Formato
  plantilla: string
  publico: Publico
  tema: Tema
  objetivo: Objetivo
  produccion: Produccion
  contenido?: Record<string, unknown>
  caption?: string
  hashtags?: string[]
  productos?: string[]
  musicaId?: string | null
  sucursalId?: string | null
  campanaId?: string | null
  briefGrabacion?: BriefGrabacion | null
  programadaPara?: Date | null
}

export type CamposTransicion = {
  renderKey?: string | null
  portadaKey?: string | null
  alertas?: AlertaPieza[]
  externoId?: string
  permalink?: string
  contenido?: Record<string, unknown>
  caption?: string
  hashtags?: string[]
  briefGrabacion?: BriefGrabacion | null
}

export type ResultadoTransicion = { ok: true; pieza: PiezaDto } | { ok: false; code: "not_found" | "invalid_transition" | "conflict" }

type Fila = typeof marketingPiezas.$inferSelect

export function aDto(f: Fila): PiezaDto {
  return {
    id: f.id,
    canal: f.canal as Canal,
    formato: f.formato as Formato,
    plantilla: f.plantilla,
    contenido: f.contenido,
    caption: f.caption,
    hashtags: f.hashtags,
    productos: f.productos,
    musicaId: f.musicaId,
    sucursalId: f.sucursalId,
    campanaId: f.campanaId,
    publico: f.publico as Publico,
    tema: f.tema as Tema,
    objetivo: f.objetivo as Objetivo,
    produccion: f.produccion as Produccion,
    briefGrabacion: f.briefGrabacion ?? null,
    programadaPara: f.programadaPara?.toISOString() ?? null,
    estado: f.estado,
    version: f.version,
    renderKey: f.renderKey,
    portadaKey: f.portadaKey,
    renderUrl: f.renderKey ? urlPublicaFoto(f.renderKey) : null,
    portadaUrl: f.portadaKey ? urlPublicaFoto(f.portadaKey) : null,
    alertas: f.alertas,
    chequeoIa: f.chequeoIa,
    origen: f.origen as "planificador" | "usuario",
    claimPor: f.claimPor,
    permalink: f.permalink,
    publicadaAt: f.publicadaAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  }
}

async function alertasDeReglas(tenantId: string, p: { caption: string; contenido: Record<string, unknown>; hashtags: string[] }): Promise<AlertaPieza[]> {
  const marca = await obtenerMarca(tenantId)
  return evaluarReglas(textosDePieza(p), marca.reglas)
}

type Ejecutor = Pick<Db, "insert">

async function registrarEvento(tenantId: string, piezaId: string, de: string | null, a: string, actor: string, nota = "", ejecutor: Ejecutor = getDb()): Promise<void> {
  await ejecutor.insert(marketingPiezaEventos).values({ tenantId, piezaId, de, a, actor, nota })
}

export async function crearPieza(tenantId: string, input: NuevaPieza, actor: { tipo: "planificador" | "usuario"; nombre: string }): Promise<PiezaDto> {
  const contenido = input.contenido ?? {}
  const caption = input.caption ?? ""
  const hashtags = input.hashtags ?? []
  const estado: EstadoPieza = input.produccion === "auto" ? "borrador" : "esperando_material"
  const alertas = await alertasDeReglas(tenantId, { caption, contenido, hashtags })
  return getDb().transaction(async (tx) => {
    const [f] = await tx
      .insert(marketingPiezas)
      .values({
        tenantId,
        canal: input.canal,
        formato: input.formato,
        plantilla: input.plantilla,
        publico: input.publico,
        tema: input.tema,
        objetivo: input.objetivo,
        produccion: input.produccion,
        contenido,
        caption,
        hashtags,
        productos: input.productos ?? [],
        musicaId: input.musicaId ?? null,
        sucursalId: input.sucursalId ?? null,
        campanaId: input.campanaId ?? null,
        briefGrabacion: input.briefGrabacion ?? null,
        programadaPara: input.programadaPara ?? null,
        estado,
        alertas,
        origen: actor.tipo,
      })
      .returning()
    await registrarEvento(tenantId, f.id, null, estado, `${actor.tipo}:${actor.nombre}`, "", tx)
    return aDto(f)
  })
}

export async function obtenerPieza(tenantId: string, id: string): Promise<PiezaDto | null> {
  if (!UUID_RE.test(id)) return null
  const [f] = await getDb().select().from(marketingPiezas).where(and(eq(marketingPiezas.tenantId, tenantId), eq(marketingPiezas.id, id)))
  return f ? aDto(f) : null
}

const MAX_PIEZAS_LISTADO = 500

/**
 * `sinFecha` trae las piezas sin `programadaPara` que siguen vivas (excluye descartadas y publicadas):
 * el calendario las muestra aparte porque ningún rango de fechas las alcanza.
 */
export async function listarPiezas(tenantId: string, f: { estado?: EstadoPieza; canal?: string; desde?: Date; hasta?: Date; sinFecha?: boolean }): Promise<PiezaDto[]> {
  const condiciones = [eq(marketingPiezas.tenantId, tenantId)]
  if (f.sinFecha) condiciones.push(isNull(marketingPiezas.programadaPara), notInArray(marketingPiezas.estado, ["descartada", "publicada"]))
  if (f.estado) condiciones.push(eq(marketingPiezas.estado, f.estado))
  if (f.canal) condiciones.push(eq(marketingPiezas.canal, f.canal))
  if (f.desde) condiciones.push(gte(marketingPiezas.programadaPara, f.desde))
  if (f.hasta) condiciones.push(lt(marketingPiezas.programadaPara, f.hasta))
  const filas = await getDb()
    .select()
    .from(marketingPiezas)
    .where(and(...condiciones))
    .orderBy(asc(marketingPiezas.programadaPara), asc(marketingPiezas.createdAt))
    .limit(MAX_PIEZAS_LISTADO)
  return filas.map(aDto)
}

export async function eventosDePieza(tenantId: string, id: string) {
  const filas = await getDb()
    .select()
    .from(marketingPiezaEventos)
    .where(and(eq(marketingPiezaEventos.tenantId, tenantId), eq(marketingPiezaEventos.piezaId, id)))
    .orderBy(asc(marketingPiezaEventos.createdAt))
  return filas.map((e) => ({ de: e.de, a: e.a, actor: e.actor, nota: e.nota, createdAt: e.createdAt.toISOString() }))
}

export async function liberarClaimsVencidos(tenantId: string): Promise<number> {
  return getDb().transaction(async (tx) => {
    const liberadas = await tx
      .update(marketingPiezas)
      .set({ estado: "borrador", claimPor: null, claimHasta: null, updatedAt: new Date() })
      .where(and(eq(marketingPiezas.tenantId, tenantId), eq(marketingPiezas.estado, "renderizando"), lt(marketingPiezas.claimHasta, sql`now()`)))
      .returning({ id: marketingPiezas.id })
    for (const { id } of liberadas) await registrarEvento(tenantId, id, "renderizando", "borrador", "sistema", "claim vencido", tx)
    return liberadas.length
  })
}

export async function reclamarPieza(tenantId: string, id: string, worker: string, ttlSeg: number): Promise<PiezaDto | null> {
  if (!UUID_RE.test(id)) return null
  const ttl = Math.min(Math.max(Math.trunc(ttlSeg), 60), 3600)
  return getDb().transaction(async (tx) => {
    const [f] = await tx
      .update(marketingPiezas)
      .set({ estado: "renderizando", claimPor: worker, claimHasta: sql`now() + make_interval(secs => ${ttl})`, updatedAt: new Date() })
      .where(and(eq(marketingPiezas.tenantId, tenantId), eq(marketingPiezas.id, id), eq(marketingPiezas.estado, "borrador")))
      .returning()
    if (!f) return null
    await registrarEvento(tenantId, id, "borrador", "renderizando", `studio:${worker}`, "", tx)
    return aDto(f)
  })
}

export async function transicionar(
  tenantId: string,
  id: string,
  a: EstadoPieza,
  actor: ActorPieza,
  opciones: {
    nombreActor?: string
    nota?: string
    campos?: CamposTransicion
    worker?: string
    /** Encola, en la misma transacción, una solicitud `cambios` para la rutina (si no hay una pendiente). */
    encolarCambios?: { nota: string }
  } = {},
): Promise<ResultadoTransicion> {
  const actual = await obtenerPieza(tenantId, id)
  if (!actual) return { ok: false, code: "not_found" }
  if (!esEstadoPieza(actual.estado)) return { ok: false, code: "invalid_transition" }
  // Un PATCH tardío del studio (claim vencido y pieza ya liberada o retomada) apunta a una arista
  // legítima del studio (renderizando → a) pero la pieza ya no está ahí: es un conflicto, no una
  // transición inválida.
  if (actor === "studio" && actual.estado !== "renderizando" && puedeTransicionar(actor, "renderizando", a)) return { ok: false, code: "conflict" }
  if (!puedeTransicionar(actor, actual.estado, a)) return { ok: false, code: "invalid_transition" }

  const condiciones = [eq(marketingPiezas.tenantId, tenantId), eq(marketingPiezas.id, id), eq(marketingPiezas.estado, actual.estado), eq(marketingPiezas.version, actual.version)]
  // El studio sólo cierra el render que él mismo reclamó: un claim vencido y retomado por otro
  // worker (o liberado a borrador) no se pisa.
  if (actor === "studio") {
    if (!opciones.worker) return { ok: false, code: "conflict" }
    condiciones.push(eq(marketingPiezas.claimPor, opciones.worker))
  }

  // Las alertas de reglas de marca y el chequeo con IA nunca los fija el cliente: el servidor
  // recalcula las de regla desde el contenido resultante. Del studio sólo se aceptan sus propias alertas.
  const { alertas: alertasCliente, ...campos } = opciones.campos ?? {}
  const escribeContenido = campos.contenido !== undefined || campos.caption !== undefined || campos.hashtags !== undefined
  const derivados: { alertas?: AlertaPieza[]; chequeoIa?: boolean } = {}
  if (escribeContenido) {
    const alertasDeRegla = await alertasDeReglas(tenantId, {
      caption: campos.caption ?? actual.caption,
      contenido: campos.contenido ?? actual.contenido,
      hashtags: campos.hashtags ?? actual.hashtags,
    })
    derivados.alertas = alertasDeRegla
    derivados.chequeoIa = false
  } else if (actor === "studio" && alertasCliente) {
    const alertasDeRegla = await alertasDeReglas(tenantId, actual)
    derivados.alertas = [
      ...alertasDeRegla,
      ...actual.alertas.filter((a) => a.fuente === "ia"),
      ...alertasCliente.filter((a) => a.fuente === "studio"),
    ]
  }
  const sale = actual.estado === "renderizando"
  return getDb().transaction(async (tx): Promise<ResultadoTransicion> => {
    const [f] = await tx
      .update(marketingPiezas)
      .set({
        ...campos,
        ...derivados,
        estado: a,
        ...(sale ? { claimPor: null, claimHasta: null } : {}),
        ...(a === "publicada" ? { publicadaAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(and(...condiciones))
      .returning()
    if (!f) return { ok: false, code: "conflict" }
    const nombre = opciones.nombreActor ?? opciones.worker
    await registrarEvento(tenantId, id, actual.estado, a, nombre ? `${actor}:${nombre}` : actor, opciones.nota ?? "", tx)
    if (opciones.encolarCambios) {
      const pendiente = await tx
        .select({ id: marketingSolicitudes.id })
        .from(marketingSolicitudes)
        .where(and(eq(marketingSolicitudes.tenantId, tenantId), eq(marketingSolicitudes.tipo, "cambios"), eq(marketingSolicitudes.piezaId, id), eq(marketingSolicitudes.estado, "pendiente")))
        .limit(1)
      if (pendiente.length === 0) await tx.insert(marketingSolicitudes).values({ tenantId, tipo: "cambios", piezaId: id, nota: opciones.encolarCambios.nota })
    }
    return { ok: true, pieza: aDto(f) }
  })
}

export async function editarContenido(
  tenantId: string,
  id: string,
  cambios: { contenido?: Record<string, unknown>; caption?: string; hashtags?: string[] },
  nombreActor: string,
): Promise<ResultadoTransicion> {
  const actual = await obtenerPieza(tenantId, id)
  if (!actual) return { ok: false, code: "not_found" }
  if (!esEstadoPieza(actual.estado) || !ESTADOS_EDITABLES.includes(actual.estado)) return { ok: false, code: "invalid_transition" }

  const contenido = cambios.contenido ?? actual.contenido
  const caption = cambios.caption ?? actual.caption
  const hashtags = cambios.hashtags ?? actual.hashtags
  // Guardar sin cambios reales no versiona la pieza ni borra su render ni deja evento.
  if (caption === actual.caption && isDeepStrictEqual(contenido, actual.contenido) && isDeepStrictEqual(hashtags, actual.hashtags)) {
    return { ok: true, pieza: actual }
  }
  const alertas = await alertasDeReglas(tenantId, { caption, contenido, hashtags })
  // Una pieza esperando material sigue esperándolo; cualquier otra vuelve a borrador para re-renderizar.
  const destino: EstadoPieza = actual.estado === "esperando_material" ? "esperando_material" : "borrador"

  return getDb().transaction(async (tx): Promise<ResultadoTransicion> => {
    const [f] = await tx
      .update(marketingPiezas)
      .set({
        contenido,
        caption,
        hashtags,
        alertas,
        chequeoIa: false,
        estado: destino,
        version: sql`${marketingPiezas.version} + 1`,
        renderKey: null,
        portadaKey: null,
        updatedAt: new Date(),
      })
      .where(and(eq(marketingPiezas.tenantId, tenantId), eq(marketingPiezas.id, id), eq(marketingPiezas.estado, actual.estado), eq(marketingPiezas.version, actual.version)))
      .returning()
    if (!f) return { ok: false, code: "conflict" }
    await registrarEvento(tenantId, id, actual.estado, destino, `usuario:${nombreActor}`, "edición de contenido", tx)
    return { ok: true, pieza: aDto(f) }
  })
}

/**
 * Chequeo de marca con IA de la rutina sobre una pieza en `para_revisar`: no cambia el estado.
 * Reemplaza las alertas de fuente "ia" (conserva las demás) y marca el chequeo como hecho.
 * Devuelve null si la pieza no existe, no está en `para_revisar` o cambió mientras tanto.
 */
export async function registrarChequeoIa(tenantId: string, id: string, alertasIa: AlertaPieza[]): Promise<PiezaDto | null> {
  const actual = await obtenerPieza(tenantId, id)
  if (!actual || actual.estado !== "para_revisar") return null
  const alertas: AlertaPieza[] = [...actual.alertas.filter((a) => a.fuente !== "ia"), ...alertasIa.map((a) => ({ ...a, fuente: "ia" as const }))]
  return getDb().transaction(async (tx) => {
    const [f] = await tx
      .update(marketingPiezas)
      .set({ alertas, chequeoIa: true, updatedAt: new Date() })
      .where(
        and(
          eq(marketingPiezas.tenantId, tenantId),
          eq(marketingPiezas.id, id),
          eq(marketingPiezas.estado, "para_revisar"),
          eq(marketingPiezas.version, actual.version),
        ),
      )
      .returning()
    if (!f) return null
    await registrarEvento(tenantId, id, "para_revisar", "para_revisar", "planificador", "chequeo IA", tx)
    return aDto(f)
  })
}
