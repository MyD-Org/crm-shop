import { NextResponse } from "next/server";
import { GeorefError, localidadPorId } from "@/lib/georef";
import { permitir } from "@/lib/rate-limit";
import { COOKIE_UBICACION, TEXTOS_UBICACION, armarUbicacion } from "@/lib/ubicacion";
import { demasiadasConsultas, errorUbicacion, ipDe, respuestaConUbicacion } from "@/lib/ubicacion-api";

/**
 * POST {id}: el visitante eligió una localidad de la lista. El servidor la vuelve a resolver en
 * Georef por id (no confía en la provincia que mande el cliente) y guarda la cookie
 * `shop_ubicacion`. DELETE: borra la cookie.
 */
const MAX_POR_MINUTO = 20;

export async function POST(req: Request) {
  if (!permitir(`ubicacion-elegir:${ipDe(req)}`, MAX_POR_MINUTO, 60_000)) return demasiadasConsultas();

  const body: unknown = await req.json().catch(() => null);
  const id = body && typeof body === "object" ? (body as { id?: unknown }).id : undefined;
  if (typeof id !== "string" || !/^\d{1,12}$/.test(id)) return errorUbicacion(TEXTOS_UBICACION.invalida, 400);

  try {
    const loc = await localidadPorId(id);
    const ubicacion = loc && armarUbicacion(loc);
    if (!ubicacion) return errorUbicacion(TEXTOS_UBICACION.sinResultados, 404);
    return respuestaConUbicacion(ubicacion);
  } catch (err) {
    console.error("[ubicacion] Georef no respondió (id):", err instanceof GeorefError ? err.motivo : "error");
    return errorUbicacion(TEXTOS_UBICACION.errorBusqueda, 502);
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_UBICACION);
  return res;
}
