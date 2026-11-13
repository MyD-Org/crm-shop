import { NextResponse } from "next/server";
import { GeorefError, coordenadasValidas, ubicacionPorCoordenadas } from "@/lib/georef";
import { permitirAsync } from "@/lib/rate-limit";
import { TEXTOS_UBICACION, armarUbicacion } from "@/lib/ubicacion";
import { envioPorZonaHabilitado } from "@/lib/envio-zona-flag";
import { leerConfigEnvio } from "@/lib/sucursales-repo";
import { localidadAtendidaEn } from "@/lib/ubicacion-zona";
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
    let resuelta = await ubicacionPorCoordenadas(lat as number, lon as number);
    // Envío por zona: Georef da el municipio, no la localidad; si el punto cae en una localidad atendida,
    // se usa ésa para que la ficha y el carrito encuentren la tarifa. Best-effort: si falla, queda la de Georef.
    if (resuelta && (await envioPorZonaHabilitado())) {
      try {
        const { metodos } = await leerConfigEnvio(undefined, { conMetodos: true });
        const atendida = localidadAtendidaEn(metodos, resuelta.provincia, lat as number, lon as number);
        if (atendida) resuelta = { ...resuelta, ...atendida };
      } catch (err) {
        console.error("[ubicacion] no se pudieron leer los métodos de envío:", err instanceof Error ? err.message : "error");
      }
    }
    const ubicacion = resuelta && armarUbicacion(resuelta);
    if (!ubicacion) return errorUbicacion(TEXTOS_UBICACION.errorUbicacion, 404);
    return respuestaConUbicacion(ubicacion);
  } catch (err) {
    // Georef caído o lento: sin ubicación, el visitante puede escribir su localidad. Sin coordenadas en el log.
    console.error("[ubicacion] Georef no respondió:", err instanceof GeorefError ? err.motivo : "error");
    return NextResponse.json({ error: TEXTOS_UBICACION.errorUbicacion }, { status: 502 });
  }
}
