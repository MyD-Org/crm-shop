import { NextResponse } from "next/server";
import { GeorefError, coordenadasValidas, ubicacionPorCoordenadas } from "@/lib/georef";
import { permitirAsync } from "@/lib/rate-limit";
import { TEXTOS_UBICACION, armarEleccion, armarUbicacion } from "@/lib/ubicacion";
import { envioPorZonaHabilitado } from "@/lib/envio-zona-flag";
import { leerConfigEnvio } from "@/lib/sucursales-repo";
import { localidadAtendidaEn } from "@/lib/ubicacion-zona";
import { demasiadasConsultas, errorUbicacion, ipDe, respuestaConEleccion } from "@/lib/ubicacion-api";
import { calleDelPunto } from "@/lib/reverse-geocode";
import { firmarGeo, geoFirmaConfigurada } from "@/lib/geo-token";
import { cotizarMetodo, type MetodoEnvio } from "@/lib/envio-zona";
import { nombreProvincia } from "@/lib/envio";

/**
 * Geolocalización con permiso del navegador: recibe {lat, lon}, consulta Georef (/ubicacion) desde
 * el servidor y guarda la cookie `shop_ubicacion`. Las coordenadas se usan en memoria y no se
 * guardan ni se loguean; la respuesta no las repite. Sin sesión (la usa cualquier visitante).
 *
 * Con el flag `envio-por-zona` (y `GEOCODE_FIRMA_SECRET`) además se hace reverse geocoding con Nominatim: si
 * el punto tiene calle, la cookie suma la calle mostrable, el CP, el nombre de la zona y un `geoToken` firmado
 * con la calle y las coordenadas (que viajan SÓLO dentro del token). Si Nominatim falla o no hay calle, queda
 * la localidad de siempre.
 */
const MAX_POR_MINUTO = 10;
/** Techo global de reverse por minuto (todos los visitantes): la política de Nominatim pide ≤ 1 por segundo. */
const REVERSE_POR_MINUTO_GLOBAL = 30;

/** Nombre de la zona que resuelve el punto con las mismas reglas que el pedido; null = ninguna. */
function zonaDelPunto(
  metodos: MetodoEnvio[],
  provinciaClave: string,
  localidad: string,
  cp: string,
  lat: number,
  lon: number,
  precision: "altura" | "calle",
): string | null {
  const ordenados = [...metodos].filter((m) => m.activo).sort((a, b) => a.orden - b.orden);
  for (const m of ordenados) {
    const r = cotizarMetodo(
      m,
      { provinciaClave, localidad, cp: cp || null, punto: { lat, lon, precision } },
      { origen: null, subtotalSinIva: 0, gratisTienda: false, gratisCupon: false },
    );
    if (r) return r.zona;
  }
  return null;
}

export async function POST(req: Request) {
  if (!await permitirAsync(`ubicacion-coord:${ipDe(req)}`, MAX_POR_MINUTO, 60_000)) return demasiadasConsultas();

  const body: unknown = await req.json().catch(() => null);
  const { lat, lon } = (body && typeof body === "object" ? body : {}) as { lat?: unknown; lon?: unknown };
  if (!coordenadasValidas(lat, lon)) return errorUbicacion(TEXTOS_UBICACION.invalida, 400);

  try {
    let resuelta = await ubicacionPorCoordenadas(lat as number, lon as number);
    let metodos: MetodoEnvio[] = [];
    // Envío por zona: Georef da el municipio, no la localidad; si el punto cae en una localidad atendida,
    // se usa ésa para que la ficha y el carrito encuentren la tarifa. Best-effort: si falla, queda la de Georef.
    const porZona = Boolean(resuelta) && (await envioPorZonaHabilitado());
    if (resuelta && porZona) {
      try {
        metodos = (await leerConfigEnvio(undefined, { conMetodos: true })).metodos ?? [];
        const atendida = localidadAtendidaEn(metodos, resuelta.provincia, lat as number, lon as number);
        if (atendida) resuelta = { ...resuelta, ...atendida };
      } catch (err) {
        console.error("[ubicacion] no se pudieron leer los métodos de envío:", err instanceof Error ? err.message : "error");
      }
    }
    const ubicacion = resuelta && armarUbicacion(resuelta);
    if (!ubicacion) return errorUbicacion(TEXTOS_UBICACION.errorUbicacion, 404);

    // Calle exacta: sólo con el flag, con el secreto para firmar y dentro del techo global de Nominatim.
    let exacta: { calle: string; cp?: string; zona?: string; geoToken: string } | null = null;
    if (porZona && geoFirmaConfigurada() && (await permitirAsync("ubicacion-reverse:global", REVERSE_POR_MINUTO_GLOBAL, 60_000))) {
      const punto = await calleDelPunto(lat as number, lon as number);
      if (punto) {
        try {
          const geoToken = firmarGeo({
            lat: lat as number,
            lon: lon as number,
            calle: punto.calle,
            ciudad: ubicacion.localidad,
            provincia: punto.provincia || nombreProvincia(ubicacion.provincia),
            cp: punto.cp,
            precision: punto.precision,
          });
          const zona = zonaDelPunto(metodos, ubicacion.provincia, ubicacion.localidad, punto.cp, lat as number, lon as number, punto.precision);
          exacta = { calle: punto.calle, ...(punto.cp ? { cp: punto.cp } : {}), ...(zona ? { zona } : {}), geoToken };
        } catch {
          exacta = null;
        }
      }
    }

    const eleccion = armarEleccion({
      tipo: "envio",
      localidad: ubicacion.localidad,
      provincia: ubicacion.provincia,
      id: ubicacion.id,
      ...(exacta ?? {}),
    });
    if (!eleccion) return errorUbicacion(TEXTOS_UBICACION.errorUbicacion, 404);
    return respuestaConEleccion(eleccion);
  } catch (err) {
    // Georef caído o lento: sin ubicación, el visitante puede escribir su localidad. Sin coordenadas en el log.
    console.error("[ubicacion] Georef no respondió:", err instanceof GeorefError ? err.motivo : "error");
    return NextResponse.json({ error: TEXTOS_UBICACION.errorUbicacion }, { status: 502 });
  }
}
