/**
 * Cliente de Georef (API pública de datos.gob.ar) para buscar localidades en el admin. Sólo se
 * llama desde el servidor (ruta `/api/admin/envios/localidades`). Toda falla (timeout, 5xx,
 * respuesta rara) sale como `GeorefError`. Copia reducida de `apps/clientes/src/lib/georef.ts`
 * (no hay paquete compartido).
 */
export const GEOREF_BASE = "https://apis.datos.gob.ar/georef/api"
export const TIMEOUT_MS = 3000
export const MIN_CARACTERES_LOCALIDAD = 4
export const MAX_LOCALIDADES = 8
/** Las localidades no se mudan: un día de caché por texto buscado. */
export const CACHE_LOCALIDADES_SEGUNDOS = 60 * 60 * 24
const CAMPOS_LOCALIDAD = "id,nombre,categoria,provincia.nombre,municipio.nombre,departamento.nombre"

export type MotivoGeorefError = "timeout" | "upstream" | "respuesta"

export class GeorefError extends Error {
  constructor(readonly motivo: MotivoGeorefError) {
    super(`Georef: ${motivo}`)
    this.name = "GeorefError"
  }
}

export interface SugerenciaLocalidad {
  id: string
  /** Nombre oficial de la localidad. */
  localidad: string
  provinciaNombre: string
  /** Partido o departamento: distingue homónimas dentro de la misma provincia. */
  partido?: string
  /** "Localidad simple", "Entidad"… */
  categoria?: string
}

/** Minúsculas, sin tildes, espacios colapsados: también es la clave de caché. */
export function normalizarBusqueda(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

type Fetcher = typeof fetch
type Opciones = RequestInit & { next?: { revalidate: number } }

async function pedir(url: URL, init: Opciones, f: Fetcher): Promise<unknown> {
  let res: Response
  try {
    res = await f(url.toString(), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
    throw new GeorefError(timeout ? "timeout" : "upstream")
  }
  if (!res.ok) throw new GeorefError("upstream")
  try {
    return await res.json()
  } catch {
    throw new GeorefError("respuesta")
  }
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)
const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null

function aSugerencia(v: unknown): SugerenciaLocalidad | null {
  const l = objeto(v)
  if (!l) return null
  const id = texto(l.id)
  const localidad = texto(l.nombre)
  const provinciaNombre = texto(objeto(l.provincia)?.nombre)
  if (!id || !localidad || !provinciaNombre || !/^\d{1,12}$/.test(id)) return null
  const partido = texto(objeto(l.departamento)?.nombre) ?? undefined
  const categoria = texto(l.categoria) ?? undefined
  return { id, localidad, provinciaNombre, ...(partido && { partido }), ...(categoria && { categoria }) }
}

/** Georef repite ciudades ("Localidad simple" y "Entidad"): una por nombre + provincia + partido, prefiriendo la que no es "Entidad". */
export function depurarLocalidades(lista: SugerenciaLocalidad[]): SugerenciaLocalidad[] {
  const elegidas = new Map<string, SugerenciaLocalidad>()
  for (const s of lista) {
    const clave = [s.localidad, s.provinciaNombre, s.partido ?? ""].map(normalizarBusqueda).join("|")
    const previa = elegidas.get(clave)
    if (!previa || (previa.categoria === "Entidad" && s.categoria !== "Entidad")) elegidas.set(clave, s)
  }
  return [...elegidas.values()]
}

/** "Localidad — Provincia"; con el partido entre paréntesis si otra opción se llama igual en la misma provincia. */
export function etiquetaLocalidad(s: SugerenciaLocalidad, todas: SugerenciaLocalidad[]): string {
  const homonimas = todas.filter(
    (o) =>
      normalizarBusqueda(o.provinciaNombre) === normalizarBusqueda(s.provinciaNombre) &&
      normalizarBusqueda(o.localidad) === normalizarBusqueda(s.localidad),
  )
  const conPartido = homonimas.length > 1 && s.partido ? ` (${s.partido})` : ""
  return `${s.localidad}${conPartido} — ${s.provinciaNombre}`
}

function sugerencias(data: unknown): SugerenciaLocalidad[] {
  const lista = objeto(data)?.localidades
  if (!Array.isArray(lista)) throw new GeorefError("respuesta")
  return lista.map(aSugerencia).filter((s): s is SugerenciaLocalidad => s !== null)
}

/** Localidades que empiezan con el texto (mínimo 4 caracteres, máximo 8). Con menos devuelve [] sin llamar a Georef. */
export async function buscarLocalidades(textoBusqueda: string, f: Fetcher = fetch): Promise<SugerenciaLocalidad[]> {
  const q = normalizarBusqueda(textoBusqueda)
  if (q.length < MIN_CARACTERES_LOCALIDAD) return []
  const url = new URL(`${GEOREF_BASE}/localidades`)
  url.searchParams.set("nombre", q)
  url.searchParams.set("max", String(MAX_LOCALIDADES))
  url.searchParams.set("campos", CAMPOS_LOCALIDAD)
  return depurarLocalidades(sugerencias(await pedir(url, { next: { revalidate: CACHE_LOCALIDADES_SEGUNDOS } }, f)))
}
