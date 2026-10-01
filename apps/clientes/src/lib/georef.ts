/**
 * Cliente de Georef (API pública y gratuita de datos.gob.ar): ubicación del visitante por
 * coordenadas y búsqueda de localidades. Sin clave ni variable de entorno.
 *
 * Sólo se llama desde el servidor (route handlers de `/api/ubicacion/*`): el navegador nunca
 * habla con Georef. No tiene SLA formal, así que cada llamada lleva un timeout corto y toda falla
 * (timeout, 5xx, respuesta rara) sale como `GeorefError`: quien llama cae a "sin ubicación" y el
 * envío queda en "costo a coordinar". Nunca se loguean las coordenadas.
 *
 * Contrato verificado (2026-09-30):
 * - `/ubicacion?lat=&lon=` → provincia, departamento y municipio (no hay localidad: la unidad más
 *   fina es el municipio).
 * - `/localidades?nombre=&max=&campos=` → por prefijo, sin sensibilidad a tildes ni mayúsculas;
 *   con menos de 4 letras devuelve 0. También acepta `id=`.
 */
import { claveProvincia } from "./sucursales";

export const GEOREF_BASE = "https://apis.datos.gob.ar/georef/api";
export const TIMEOUT_MS = 3000;
export const MIN_CARACTERES_LOCALIDAD = 4;
export const MAX_LOCALIDADES = 8;
/** Las búsquedas por texto se repiten entre visitantes y las localidades no se mudan: un día. */
export const CACHE_LOCALIDADES_SEGUNDOS = 60 * 60 * 24;
const CAMPOS_LOCALIDAD = "id,nombre,provincia.nombre,municipio.nombre";

/** Argentina continental e insular (con margen): fuera de esta caja ni se llama a Georef. */
export const CAJA_ARGENTINA = { latMin: -56, latMax: -21, lonMin: -74, lonMax: -53 } as const;

export type MotivoGeorefError = "timeout" | "upstream" | "respuesta";

export class GeorefError extends Error {
  constructor(readonly motivo: MotivoGeorefError) {
    super(`Georef: ${motivo}`);
    this.name = "GeorefError";
  }
}

/** Dónde está el visitante, con la provincia ya normalizada a la clave del Shop. */
export interface UbicacionResuelta {
  localidad: string;
  /** Clave canónica (`claveProvincia`). */
  provincia: string;
  /** Sólo en las que salen de `/localidades`. */
  id?: string;
}

export interface SugerenciaLocalidad extends UbicacionResuelta {
  id: string;
  /** Nombre oficial de la provincia, para mostrar "Localidad — Provincia". */
  provinciaNombre: string;
}

/** Nombre oficial de Georef → clave de provincia del Shop; null si no es una jurisdicción conocida. */
export function provinciaDeGeoref(nombre: string | null | undefined): string | null {
  return claveProvincia(nombre) || null;
}

/** ¿Son coordenadas dentro de Argentina? Filtra lo que no tiene sentido mandar a Georef. */
export function coordenadasValidas(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= CAJA_ARGENTINA.latMin &&
    lat <= CAJA_ARGENTINA.latMax &&
    lon >= CAJA_ARGENTINA.lonMin &&
    lon <= CAJA_ARGENTINA.lonMax
  );
}

/** Texto de búsqueda normalizado (minúsculas, sin tildes, espacios colapsados): también es la clave de caché. */
export function normalizarBusqueda(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Fetcher = typeof fetch;
type Opciones = RequestInit & { next?: { revalidate: number } };

async function pedir(url: URL, init: Opciones, f: Fetcher): Promise<unknown> {
  let res: Response;
  try {
    res = await f(url.toString(), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new GeorefError(timeout ? "timeout" : "upstream");
  }
  if (!res.ok) throw new GeorefError("upstream");
  try {
    return await res.json();
  } catch {
    throw new GeorefError("respuesta");
  }
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Provincia y municipio de unas coordenadas. `null` = Georef no reconoce el punto (fuera del país
 * o sin provincia). Sin caché: son datos personales y no se repiten.
 */
export async function ubicacionPorCoordenadas(
  lat: number,
  lon: number,
  f: Fetcher = fetch,
): Promise<UbicacionResuelta | null> {
  const url = new URL(`${GEOREF_BASE}/ubicacion`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  const data = objeto(await pedir(url, { cache: "no-store" }, f));
  const u = objeto(data?.ubicacion);
  if (!u) throw new GeorefError("respuesta");
  const provincia = provinciaDeGeoref(texto(objeto(u.provincia)?.nombre));
  if (!provincia) return null;
  const localidad = texto(objeto(u.municipio)?.nombre) ?? texto(objeto(u.departamento)?.nombre);
  if (!localidad) return null;
  return { localidad, provincia };
}

function aSugerencia(v: unknown): SugerenciaLocalidad | null {
  const l = objeto(v);
  if (!l) return null;
  const id = texto(l.id);
  const localidad = texto(l.nombre);
  const provinciaNombre = texto(objeto(l.provincia)?.nombre);
  const provincia = provinciaDeGeoref(provinciaNombre);
  if (!id || !localidad || !provincia || !provinciaNombre || !/^\d{1,12}$/.test(id)) return null;
  return { id, localidad, provincia, provinciaNombre };
}

function sugerencias(data: unknown): SugerenciaLocalidad[] {
  const lista = objeto(data)?.localidades;
  if (!Array.isArray(lista)) throw new GeorefError("respuesta");
  return lista.map(aSugerencia).filter((s): s is SugerenciaLocalidad => s !== null);
}

/**
 * Localidades que empiezan con el texto (mínimo 4 caracteres, máximo 8 resultados). Con menos
 * caracteres devuelve [] sin llamar a Georef. Cacheada en servidor por texto normalizado.
 */
export async function buscarLocalidades(textoBusqueda: string, f: Fetcher = fetch): Promise<SugerenciaLocalidad[]> {
  const q = normalizarBusqueda(textoBusqueda);
  if (q.length < MIN_CARACTERES_LOCALIDAD) return [];
  const url = new URL(`${GEOREF_BASE}/localidades`);
  url.searchParams.set("nombre", q);
  url.searchParams.set("max", String(MAX_LOCALIDADES));
  url.searchParams.set("campos", CAMPOS_LOCALIDAD);
  return sugerencias(await pedir(url, { next: { revalidate: CACHE_LOCALIDADES_SEGUNDOS } }, f));
}

/** Una localidad por su id (el servidor re-resuelve lo que eligió el visitante: no confía en el cliente). */
export async function localidadPorId(id: string, f: Fetcher = fetch): Promise<SugerenciaLocalidad | null> {
  if (!/^\d{1,12}$/.test(id)) return null;
  const url = new URL(`${GEOREF_BASE}/localidades`);
  url.searchParams.set("id", id);
  url.searchParams.set("max", "1");
  url.searchParams.set("campos", CAMPOS_LOCALIDAD);
  return sugerencias(await pedir(url, { next: { revalidate: CACHE_LOCALIDADES_SEGUNDOS } }, f))[0] ?? null;
}
