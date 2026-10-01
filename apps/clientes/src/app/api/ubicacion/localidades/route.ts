import { NextResponse } from "next/server";
import { GeorefError, MIN_CARACTERES_LOCALIDAD, buscarLocalidades } from "@/lib/georef";
import { permitir } from "@/lib/rate-limit";
import { TEXTOS_UBICACION } from "@/lib/ubicacion";
import { demasiadasConsultas, errorUbicacion, ipDe } from "@/lib/ubicacion-api";

/**
 * Autocompletado de localidades (Georef /localidades) desde el servidor: el navegador nunca llama
 * a datos.gob.ar. Mínimo 4 caracteres, máximo 8 resultados, caché por texto normalizado (en
 * `buscarLocalidades`) y rate limit por IP. Sin sesión.
 */
const MAX_POR_MINUTO = 30;
const MAX_LARGO = 60;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_CARACTERES_LOCALIDAD) return NextResponse.json({ localidades: [] });
  if (q.length > MAX_LARGO) return errorUbicacion(TEXTOS_UBICACION.invalida, 400);
  if (!permitir(`ubicacion-loc:${ipDe(req)}`, MAX_POR_MINUTO, 60_000)) return demasiadasConsultas();

  try {
    const sugerencias = await buscarLocalidades(q);
    return NextResponse.json({
      localidades: sugerencias.map((s) => ({
        id: s.id,
        etiqueta: `${s.localidad} — ${s.provinciaNombre}`,
      })),
    });
  } catch (err) {
    console.error("[ubicacion] Georef no respondió (localidades):", err instanceof GeorefError ? err.motivo : "error");
    return errorUbicacion(TEXTOS_UBICACION.errorBusqueda, 502);
  }
}
