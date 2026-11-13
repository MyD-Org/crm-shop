import { NextResponse } from "next/server";
import { GeorefError, MIN_CARACTERES_LOCALIDAD, buscarLocalidades, etiquetaLocalidad, type SugerenciaLocalidad } from "@/lib/georef";
import { permitirAsync } from "@/lib/rate-limit";
import { TEXTOS_UBICACION } from "@/lib/ubicacion";
import { demasiadasConsultas, errorUbicacion, ipDe } from "@/lib/ubicacion-api";
import { envioPorZonaHabilitado } from "@/lib/envio-zona-flag";
import { localesAtendidas, priorizarLocalidades, type LocalAtendida } from "@/lib/localidades-busqueda";
import { reglasVentaCacheadas, sucursalesCacheadas } from "@/lib/sucursales-datos";

/**
 * Autocompletado de localidades (Georef /localidades) desde el servidor: el navegador nunca llama
 * a datos.gob.ar. Mínimo 4 caracteres, máximo 8 resultados, caché por texto normalizado (en
 * `buscarLocalidades`) y rate limit por IP. Sin sesión.
 *
 * Con el flag `envio-por-zona` se priorizan las localidades que atiende el comercio y se entienden sus
 * abreviaturas ("mdp" = Mar del Plata, aun con menos de 4 caracteres); si Georef cae y alguna coincide,
 * se responde igual con esas. La lectura de las localidades sale de la caché del Shop (0 llamadas extra).
 * Con el flag apagado es la ruta de siempre.
 */
const MAX_POR_MINUTO = 30;
const MAX_LARGO = 60;

/** Las localidades del comercio; [] con el flag apagado o si la lectura falla. */
async function localesDelComercio(): Promise<LocalAtendida[]> {
  try {
    if (!(await envioPorZonaHabilitado())) return [];
    const [reglas, datos] = await Promise.all([reglasVentaCacheadas(true), sucursalesCacheadas()]);
    return localesAtendidas(reglas.envio?.metodos ?? [], datos.sucursales);
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length > MAX_LARGO) return errorUbicacion(TEXTOS_UBICACION.invalida, 400);
  const locales = q.length > 0 ? await localesDelComercio() : [];
  // Con menos de 4 caracteres sólo puede responder una abreviatura del comercio.
  if (q.length < MIN_CARACTERES_LOCALIDAD && locales.length === 0) return NextResponse.json({ localidades: [] });
  if (!await permitirAsync(`ubicacion-loc:${ipDe(req)}`, MAX_POR_MINUTO, 60_000)) return demasiadasConsultas();

  if (q.length < MIN_CARACTERES_LOCALIDAD) {
    return NextResponse.json({ localidades: priorizarLocalidades(q, [], locales) });
  }

  let sugerencias: SugerenciaLocalidad[];
  try {
    sugerencias = await buscarLocalidades(q);
  } catch (err) {
    console.error("[ubicacion] Georef no respondió (localidades):", err instanceof GeorefError ? err.motivo : "error");
    const delComercio = priorizarLocalidades(q, [], locales);
    if (delComercio.length > 0) return NextResponse.json({ localidades: delComercio });
    return errorUbicacion(TEXTOS_UBICACION.errorBusqueda, 502);
  }
  if (locales.length === 0) {
    return NextResponse.json({
      localidades: sugerencias.map((s) => ({ id: s.id, etiqueta: etiquetaLocalidad(s, sugerencias) })),
    });
  }
  return NextResponse.json({ localidades: priorizarLocalidades(q, sugerencias, locales) });
}
