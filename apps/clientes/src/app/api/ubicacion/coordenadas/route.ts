import { NextResponse } from "next/server";
import { GeorefError, coordenadasValidas, ubicacionPorCoordenadas } from "@/lib/georef";
import { permitirAsync } from "@/lib/rate-limit";
import { TEXTOS_UBICACION, armarUbicacion } from "@/lib/ubicacion";
import { demasiadasConsultas, errorUbicacion, ipDe, respuestaConUbicacion } from "@/lib/ubicacion-api";

/**
 * Geolocalización con permiso del navegador: recibe {lat, lon}, consulta Georef (/ubicacion) desde
 * el servidor y guarda la cookie `shop_ubicacion`. Las coordenadas se usan en memoria y no se
 * guardan ni se loguean; la respuesta no las repite. Sin sesión (la usa cualquier visitante).
 */
const MAX_POR_MINUTO = 10;

export async function POST(req: Request) {
  if (!await permitirAsync(`ubicacion-coord:${ipDe(req)}`, MAX_POR_MINUTO, 60_000)) return demasiadasConsultas();

  const body: unknown = await req.json().catch(() => null);
  const { lat, lon } = (body && typeof body === "object" ? body : {}) as { lat?: unknown; lon?: unknown };
  if (!coordenadasValidas(lat, lon)) return errorUbicacion(TEXTOS_UBICACION.invalida, 400);

  try {
    const resuelta = await ubicacionPorCoordenadas(lat as number, lon as number);
    const ubicacion = resuelta && armarUbicacion(resuelta);
    if (!ubicacion) return errorUbicacion(TEXTOS_UBICACION.errorUbicacion, 404);
    return respuestaConUbicacion(ubicacion);
  } catch (err) {
    // Georef caído o lento: sin ubicación, el visitante puede escribir su localidad. Sin coordenadas en el log.
    console.error("[ubicacion] Georef no respondió:", err instanceof GeorefError ? err.motivo : "error");
    return NextResponse.json({ error: TEXTOS_UBICACION.errorUbicacion }, { status: 502 });
  }
}
