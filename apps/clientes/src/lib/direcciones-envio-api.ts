/**
 * Piezas comunes de la API de direcciones de envío
 * (`/api/mi-cuenta/direcciones/**`). SOLO servidor.
 *
 * Misma forma que la API de favoritos: sólo Clerk (la cookie del CRM no tiene
 * dónde guardar direcciones), rate limit por usuario compartido entre todas
 * las rutas, errores en usted y `Cache-Control: private, no-store` en TODA
 * respuesta.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { MAX_DIRECCIONES, validarDireccion, type DatosDireccion } from "./direcciones-envio";
import { permitirAsync } from "./rate-limit";
import { verificarGeo } from "./geo-token";

/** Usos por minuto y por usuario, sumando todos los métodos y rutas. */
const USOS_POR_MINUTO = 60;

const SIN_CACHE = { "Cache-Control": "private, no-store" };

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SIN_CACHE });
}

/** Mismo cuerpo y headers para "no existe" y "es de otro": no se distingue. */
export const noEncontrada = () => json({ error: "No encontramos esa dirección." }, 404);

export const direccionesLlenas = () =>
  json({ error: `Alcanzó el máximo de ${MAX_DIRECCIONES} direcciones guardadas.` }, 422);

/** Usuario de Clerk que pide, o la respuesta de error (401 / 429). */
export async function solicitante(): Promise<{ userId: string } | { error: NextResponse }> {
  const { userId } = await auth();
  if (!userId) return { error: json({ error: "No autorizado" }, 401) };
  if (!await permitirAsync(`direcciones:clerk:${userId}`, USOS_POR_MINUTO, 60_000)) {
    return {
      error: json({ error: "Demasiadas solicitudes. Inténtelo de nuevo en unos minutos." }, 429),
    };
  }
  return { userId };
}

/** Ubicación de una dirección, escrita por el servidor a partir de un `geoToken` firmado. */
export interface UbicacionDireccion {
  lat: number;
  lon: number;
}

/**
 * Ubicación que vale del cuerpo: sólo la de un `geoToken` válido cuya calle es la que se guarda. Nunca
 * lat/lon sueltos. null = sin ubicación verificada (sin token, falsificado, vencido o de otra calle).
 */
export function ubicacionDelCuerpo(cuerpo: unknown, calle: string): UbicacionDireccion | null {
  if (typeof cuerpo !== "object" || cuerpo === null) return null;
  const g = verificarGeo((cuerpo as { geoToken?: unknown }).geoToken, { calle });
  return g ? { lat: g.lat, lon: g.lon } : null;
}

/** Datos validados del cuerpo, o la respuesta de error (400 / 422). */
export async function datosDelCuerpo(
  req: Request,
): Promise<{ datos: DatosDireccion; ubicacion: UbicacionDireccion | null } | { error: NextResponse }> {
  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    cuerpo = undefined;
  }
  const r = validarDireccion(cuerpo);
  if (r.ok) return { datos: r.datos, ubicacion: ubicacionDelCuerpo(cuerpo, r.datos.calle) };
  if (r.motivo === "cuerpo") return { error: json({ error: "Solicitud inválida." }, 400) };
  return { error: json({ error: "Revise los datos de la dirección.", errores: r.errores }, 422) };
}

/** Contexto de las rutas `[id]` (en esta versión de Next `params` es una Promise). */
export type ContextoId = { params: Promise<{ id: string }> };
