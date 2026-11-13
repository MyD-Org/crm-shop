/**
 * Reverse geocoding de «Usar mi ubicación» con el envío por zona (flag `envio-por-zona`). SOLO servidor.
 *
 * Georef `/ubicacion` sólo da el municipio; Nominatim `/reverse` da la CALLE (y la altura, si la tiene el
 * mapa) del punto. Mismo `User-Agent` identificable que `/api/geocode` (política de uso de Nominatim).
 *
 * Las coordenadas viajan en la URL de la consulta: la respuesta NO se cachea (`no-store`) y nada se loguea.
 * Cualquier falla (timeout, 4xx/5xx, respuesta rara, sin calle) devuelve null: quien llama sigue con lo de hoy.
 */
import { getMarca } from "./marca";
import { idTecnico } from "./marca-base";
import { normalizarCp } from "./ubicacion";

export const TIMEOUT_REVERSE_MS = 3000;

interface RespuestaReverse {
  address?: {
    road?: string;
    pedestrian?: string;
    house_number?: string;
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    village?: string;
    postcode?: string;
    state?: string;
  };
}

export interface CallePunto {
  /** "<calle> <altura>" (sin altura si el mapa no la tiene). */
  calle: string;
  ciudad: string;
  provincia: string;
  /** CP normalizado; "" si no hay uno válido. */
  cp: string;
  precision: "altura" | "calle";
}

/** Saca los prefijos administrativos de OSM («Municipio de X», «Provincia de Y»). */
function limpiarNombre(v: string | undefined): string {
  if (!v) return "";
  return v
    .replace(/^(Municipio|Partido|Departamento|Provincia|Comuna|Estado)\s+(de|do|da)\s+/i, "")
    .replace(/^Municipio\s+/i, "")
    .trim();
}

export function urlReverse(lat: number, lon: number): URL {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("accept-language", "es");
  return url;
}

async function userAgent(): Promise<string> {
  return `${idTecnico(await getMarca())}-Shop/1.0 (${process.env.GEOCODE_CONTACT_EMAIL ?? "contacto@cliente.example"})`;
}

/** La calle de un punto, o null si Nominatim no responde o el punto no tiene calle. */
export async function calleDelPunto(lat: number, lon: number): Promise<CallePunto | null> {
  try {
    const res = await fetch(urlReverse(lat, lon).toString(), {
      headers: { "User-Agent": await userAgent() },
      signal: AbortSignal.timeout(TIMEOUT_REVERSE_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RespuestaReverse | null;
    const a = data?.address;
    if (!a) return null;
    const via = a.road ?? a.pedestrian;
    if (!via) return null;
    const altura = a.house_number?.trim();
    return {
      calle: [via, altura].filter(Boolean).join(" ").trim(),
      ciudad: limpiarNombre(a.city ?? a.town ?? a.village),
      provincia: limpiarNombre(a.state),
      cp: normalizarCp(a.postcode) ?? "",
      precision: altura ? "altura" : "calle",
    };
  } catch {
    return null;
  }
}
