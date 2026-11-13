/**
 * Token de ubicación de una dirección elegida del autocompletado (change `envio-por-zona-con-tarifa`).
 * SOLO servidor.
 *
 * Un lat/lon mandado por el navegador permitiría falsificar la zona de envío (y pagar menos). Por eso
 * `/api/geocode` devuelve cada sugerencia con un `geoToken`: HMAC-SHA256 con `GEOCODE_FIRMA_SECRET`
 * sobre `{lat, lon, calle, ciudad, provincia, cp, precision, iat}`. Cotizar y crear el pedido aceptan
 * unas coordenadas SOLO si traen un token válido cuya `calle` coincide con la calle enviada y que no
 * venció (24 h). Los lat/lon crudos del body se ignoran.
 *
 * El secreto se lee en cada llamada y nunca en el import: si falta (o es corto), `verificarGeo`
 * devuelve null (sin ubicación verificada) y `firmarGeo` lanza; con el flag `envio-por-zona` apagado
 * nada de esto se ejecuta, así que la variable puede faltar sin romper nada.
 *
 * Formato: `<payload JSON base64url>.<HMAC-SHA256 base64url>`.
 */
import { createHmac } from "crypto";
import { claveTexto } from "./texto-clave";
import { secureCompare } from "./secure-compare";

export const GEO_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const LARGO_MINIMO_SECRETO = 32;
/** Tolerancia de reloj entre instancias: un `iat` más allá de esto en el futuro se rechaza. */
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

/** Misma caja que `CAJA_ARGENTINA` de georef.ts / `CAJA_AR` de geo-poligono.ts. */
const LAT_MIN = -56;
const LAT_MAX = -21;
const LON_MIN = -74;
const LON_MAX = -53;

export type PrecisionGeo = "altura" | "calle";

export interface DatosGeo {
  lat: number;
  lon: number;
  calle: string;
  ciudad: string;
  provincia: string;
  cp: string;
  precision: PrecisionGeo;
}

/** Lo que devuelve una verificación exitosa: coordenadas y datos de la dirección firmada. */
export interface GeoVerificado {
  lat: number;
  lon: number;
  precision: PrecisionGeo;
  ciudad: string;
  provincia: string;
  cp: string;
}

export class GeoSecretoFaltanteError extends Error {
  constructor() {
    super("Falta GEOCODE_FIRMA_SECRET (o es demasiado corto) para firmar la ubicación de la dirección.");
    this.name = "GeoSecretoFaltanteError";
  }
}

function secreto(): string | null {
  const v = process.env.GEOCODE_FIRMA_SECRET;
  return v && v.length >= LARGO_MINIMO_SECRETO ? v : null;
}

/** ¿Se puede firmar/verificar? (el geocode no devuelve token si no hay secreto). */
export function geoFirmaConfigurada(): boolean {
  return secreto() !== null;
}

function firma(payload: string, clave: string): string {
  return createHmac("sha256", clave).update(payload).digest("base64url");
}

export function firmarGeo(datos: DatosGeo, ahora: number = Date.now()): string {
  const clave = secreto();
  if (!clave) throw new GeoSecretoFaltanteError();
  const payload = Buffer.from(JSON.stringify({ ...datos, iat: ahora })).toString("base64url");
  return `${payload}.${firma(payload, clave)}`;
}

const esNumero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const esTexto = (v: unknown): v is string => typeof v === "string";

/**
 * Valida el token y que la calle enviada sea la firmada (misma calle y altura, sin acentos ni signos).
 * null = sin ubicación verificada (token ausente, falsificado, vencido, de otra calle o sin secreto).
 */
export function verificarGeo(
  token: unknown,
  esperado: { calle: string },
  ahora: number = Date.now(),
): GeoVerificado | null {
  if (!esTexto(token)) return null;
  const clave = secreto();
  if (!clave) return null;
  const partes = token.split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  const [payload, recibida] = partes;
  if (!secureCompare(recibida, firma(payload, clave))) return null;

  let d: unknown;
  try {
    d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof d !== "object" || d === null) return null;
  const o = d as Record<string, unknown>;
  if (
    !esNumero(o.lat) ||
    !esNumero(o.lon) ||
    !esNumero(o.iat) ||
    !esTexto(o.calle) ||
    !esTexto(o.ciudad) ||
    !esTexto(o.provincia) ||
    !esTexto(o.cp) ||
    (o.precision !== "altura" && o.precision !== "calle")
  ) {
    return null;
  }
  if (o.lat < LAT_MIN || o.lat > LAT_MAX || o.lon < LON_MIN || o.lon > LON_MAX) return null;
  if (o.iat > ahora + TOLERANCIA_FUTURO_MS || ahora - o.iat > GEO_TOKEN_TTL_MS) return null;
  const calleEnviada = claveTexto(esperado.calle ?? "");
  if (!calleEnviada || calleEnviada !== claveTexto(o.calle)) return null;
  return { lat: o.lat, lon: o.lon, precision: o.precision, ciudad: o.ciudad, provincia: o.provincia, cp: o.cp };
}
