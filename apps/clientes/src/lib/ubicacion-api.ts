/**
 * Piezas comunes de las rutas `/api/ubicacion/*`: IP del solicitante, cookie y respuestas de error.
 */
import { NextResponse } from "next/server";
import {
  COOKIE_UBICACION,
  COOKIE_UBICACION_MAX_AGE,
  TEXTOS_UBICACION,
  serializarCookieUbicacion,
  type CookieUbicacion,
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

/** Cookie HttpOnly: sólo la lee el servidor. Reemplaza por completo la elección anterior. */
export function armarCookie(c: CookieUbicacion): string {
  return serializarCookieUbicacion(c);
}

const OPCIONES_COOKIE = () =>
  ({
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_UBICACION_MAX_AGE,
  }) as const;

/**
 * Respuesta con la elección y la cookie puesta. El cuerpo es aditivo: `tipo` siempre; en envío
 * `localidad`/`provincia`; en retiro `sucursal` (slug) si la hay.
 */
export function respuestaConEleccion(c: CookieUbicacion): NextResponse {
  const cuerpo =
    c.tipo === "retiro"
      ? { tipo: "retiro" as const, ...(c.sucursal ? { sucursal: c.sucursal } : {}) }
      : { tipo: "envio" as const, localidad: c.localidad, provincia: c.provincia };
  const res = NextResponse.json(cuerpo);
  res.cookies.set(COOKIE_UBICACION, armarCookie(c), OPCIONES_COOKIE());
  return res;
}

/** Elección de envío desde una localidad (geolocalización, sin código postal). */
export function respuestaConUbicacion(u: UbicacionVisitante): NextResponse {
  return respuestaConEleccion({ tipo: "envio", ...u });
}
