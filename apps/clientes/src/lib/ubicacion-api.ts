/**
 * Piezas comunes de las rutas `/api/ubicacion/*`: IP del solicitante, cookie y respuestas de error.
 */
import { NextResponse } from "next/server";
import {
  COOKIE_UBICACION,
  COOKIE_UBICACION_MAX_AGE,
  TEXTOS_UBICACION,
  serializarCookieUbicacion,
  type UbicacionVisitante,
} from "./ubicacion";

/** Primera IP de `x-forwarded-for` (la del cliente en Vercel), o `x-real-ip`. Sólo para el rate limit. */
export function ipDe(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || req.headers.get("x-real-ip")?.trim() || "desconocida";
}

export function errorUbicacion(mensaje: string, status: number): NextResponse {
  return NextResponse.json({ error: mensaje }, { status });
}

export const demasiadasConsultas = () => errorUbicacion(TEXTOS_UBICACION.demasiadas, 429);

/** Respuesta con la ubicación y la cookie puesta (HttpOnly: sólo la lee el servidor). */
export function respuestaConUbicacion(u: UbicacionVisitante): NextResponse {
  const res = NextResponse.json({ localidad: u.localidad, provincia: u.provincia });
  res.cookies.set(COOKIE_UBICACION, serializarCookieUbicacion(u), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_UBICACION_MAX_AGE,
  });
  return res;
}
