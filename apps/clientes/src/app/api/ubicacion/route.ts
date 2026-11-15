import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { esIdDireccion, validarDireccion } from "@/lib/direcciones-envio";
import { crearDireccion, DireccionesLlenasError, listarDirecciones } from "@/lib/direcciones-envio-db";
import { claveTexto } from "@/lib/texto-clave";
import { GeorefError, localidadPorId } from "@/lib/georef";
import { verificarGeo } from "@/lib/geo-token";
import { envioPorZonaHabilitado } from "@/lib/envio-zona-flag";
import { leerConfigEnvio } from "@/lib/sucursales-repo";
import { zonaDelPunto } from "@/lib/ubicacion-zona";
import { permitirAsync } from "@/lib/rate-limit";
import { sucursalesHabilitadas } from "@/lib/sucursales-flag";
import { claveProvincia } from "@/lib/sucursales";
import {
  COOKIE_UBICACION,
  TEXTOS_UBICACION,
  armarEleccion,
  armarUbicacion,
  normalizarCp,
} from "@/lib/ubicacion";
import { demasiadasConsultas, errorUbicacion, ipDe, respuestaConEleccion } from "@/lib/ubicacion-api";
import { retiroValido } from "@/lib/ubicacion-retiro";

/**
 * POST: el visitante elige DÓNDE recibir su compra. El cuerpo es UNO de (excluyentes):
 *  - `{ id, cp?, calle?, geoToken? }`: una localidad de Georef. El servidor la vuelve a resolver por id
 *    (no confía en la provincia que mande el cliente). El código postal es opcional (el
 *    Shop ya no lo pide; si llega, se valida y se guarda). Con el envío por zona, `calle` + `geoToken`
 *    (una sugerencia de `/api/geocode`) suman el punto exacto: se verifica el token contra la calle.
 *  - `{ calle, geoToken }`: una dirección elegida en el buscador del modal (sugerencia de `/api/geocode`, con
 *    el envío por zona). Localidad y provincia salen del token verificado, no del cliente.
 *  - `{ direccionId }`: una dirección guardada. Exige sesión y que sea del usuario.
 *  - `{ tipo: "retiro", sucursal? }`: retiro en un local (sin `sucursal` sólo con el flag
 *    `sucursales` apagado: local único).
 * Cada rama valida y arma la cookie `shop_ubicacion` en el servidor; el cliente sólo manda ids. La
 * nueva elección reemplaza por completo a la anterior. DELETE: borra la cookie.
 */
const MAX_POR_MINUTO = 20;

const invalida = () => errorUbicacion(TEXTOS_UBICACION.invalida, 400);

export async function POST(req: Request) {
  if (!await permitirAsync(`ubicacion-elegir:${ipDe(req)}`, MAX_POR_MINUTO, 60_000)) return demasiadasConsultas();

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalida();
  const b = body as Record<string, unknown>;

  const conId = b.id !== undefined;
  const conDireccion = b.direccionId !== undefined;
  const conTipo = b.tipo !== undefined;
  const soloCalle = !conId && b.calle !== undefined;
  // Un solo payload por pedido: mezclar ramas es un pedido inválido.
  if ([conId || soloCalle, conDireccion, conTipo].filter(Boolean).length !== 1) return invalida();
  if (conTipo && (b.tipo !== "retiro" || b.id !== undefined || b.cp !== undefined)) return invalida();
  if (conDireccion && b.cp !== undefined) return invalida();
  // La calle exacta va sola o con una localidad, y siempre con su token.
  if ((b.calle !== undefined || b.geoToken !== undefined) && (conDireccion || conTipo || b.calle === undefined || b.geoToken === undefined)) {
    return invalida();
  }
  if (soloCalle) return elegirCalle(b.calle, b.geoToken, b.cp);

  if (conTipo) return elegirRetiro(b.sucursal);
  if (conDireccion) return elegirDireccion(b.direccionId);
  return elegirLocalidad(b.id, b.cp, b.calle, b.geoToken);
}

async function elegirRetiro(sucursal: unknown): Promise<NextResponse> {
  const eleccion = armarEleccion({ tipo: "retiro", sucursal });
  if (!eleccion || eleccion.tipo !== "retiro") return errorUbicacion(TEXTOS_UBICACION.localInvalido, 400);
  const valido = await retiroValido(eleccion);
  if (!valido) {
    // Con sucursales encendidas, un slug que no existe (o no acepta retiro) es "no encontrado".
    const noEncontrado = Boolean(eleccion.sucursal) && (await sucursalesHabilitadas());
    return noEncontrado
      ? errorUbicacion(TEXTOS_UBICACION.localNoEncontrado, 404)
      : errorUbicacion(TEXTOS_UBICACION.localInvalido, 400);
  }
  return respuestaConEleccion(eleccion);
}

async function elegirDireccion(direccionId: unknown): Promise<NextResponse> {
  if (typeof direccionId !== "string" || !esIdDireccion(direccionId)) {
    return errorUbicacion(TEXTOS_UBICACION.direccionInvalida, 400);
  }
  const { userId } = await auth();
  if (!userId) return errorUbicacion(TEXTOS_UBICACION.sinSesion, 401);
  const d = (await listarDirecciones(userId)).find((x) => x.id === direccionId);
  // Ajena e inexistente responden igual: nada de esa dirección sale del servidor.
  if (!d) return errorUbicacion(TEXTOS_UBICACION.direccionNoEncontrada, 404);
  const eleccion = armarEleccion({
    tipo: "envio",
    localidad: d.ciudad,
    provincia: claveProvincia(d.provincia),
    cp: d.cp,
    direccionId: d.id,
  });
  if (!eleccion) return errorUbicacion(TEXTOS_UBICACION.direccionInvalida, 400);
  return respuestaConEleccion(eleccion);
}

async function elegirLocalidad(id: unknown, cpEntrada: unknown, calle?: unknown, geoToken?: unknown): Promise<NextResponse> {
  if (typeof id !== "string" || !/^\d{1,12}$/.test(id)) return invalida();

  let cp: string | undefined;
  if (cpEntrada !== undefined && cpEntrada !== null) {
    const n = normalizarCp(cpEntrada);
    if (!n) return errorUbicacion(TEXTOS_UBICACION.cpInvalido, 400);
    cp = n;
  }

  try {
    const loc = await localidadPorId(id);
    const ubicacion = loc && armarUbicacion(loc);
    if (!ubicacion) return errorUbicacion(TEXTOS_UBICACION.sinResultados, 404);
    if (calle !== undefined) {
      const exacta = await puntoExacto(calle, geoToken, ubicacion.provincia, ubicacion.localidad);
      if (!exacta) return errorUbicacion(TEXTOS_UBICACION.direccionSinVerificar, 400);
      const guardada = await guardarEnSusDirecciones(exacta.calle, exacta.geoToken);
      if (guardada) return guardada;
      const eleccion = armarEleccion({ tipo: "envio", ...ubicacion, ...exacta });
      if (!eleccion) return errorUbicacion(TEXTOS_UBICACION.direccionSinVerificar, 400);
      return respuestaConEleccion(eleccion);
    }
    return respuestaConEleccion({ tipo: "envio", ...ubicacion, ...(cp ? { cp } : {}) });
  } catch (err) {
    console.error("[ubicacion] Georef no respondió (id):", err instanceof GeorefError ? err.motivo : "error");
    return errorUbicacion(TEXTOS_UBICACION.errorBusqueda, 502);
  }
}

async function elegirCalle(calle: unknown, geoToken: unknown, cp: unknown): Promise<NextResponse> {
  if (cp !== undefined) return invalida();
  if (typeof calle !== "string" || typeof geoToken !== "string") return invalida();
  const g = verificarGeo(geoToken, { calle });
  const ubicacion = g && armarUbicacion({ localidad: g.ciudad, provincia: claveProvincia(g.provincia) });
  if (!ubicacion) return errorUbicacion(TEXTOS_UBICACION.direccionSinVerificar, 400);
  const exacta = await puntoExacto(calle, geoToken, ubicacion.provincia, ubicacion.localidad);
  if (!exacta) return errorUbicacion(TEXTOS_UBICACION.direccionSinVerificar, 400);
  const guardada = await guardarEnSusDirecciones(exacta.calle, exacta.geoToken);
  if (guardada) return guardada;
  const eleccion = armarEleccion({ tipo: "envio", ...ubicacion, ...exacta });
  if (!eleccion) return errorUbicacion(TEXTOS_UBICACION.direccionSinVerificar, 400);
  return respuestaConEleccion(eleccion);
}

/**
 * Con sesión, la calle elegida (ya verificada) queda en «Mis direcciones» y la elección pasa a ser esa
 * dirección guardada: así el checkout la ofrece como cualquier otra, sin vencer a las 24 h. Si ya tiene una
 * con la misma calle y ciudad se reusa. Sin sesión, sin CP válido o con el tope de direcciones: null, y queda
 * la calle exacta en la cookie como antes. Nunca rompe la elección: un error al guardar se loguea y sigue.
 */
async function guardarEnSusDirecciones(calle: string, geoToken: string): Promise<NextResponse | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const g = verificarGeo(geoToken, { calle });
  if (!g) return null;
  const v = validarDireccion({ calle, ciudad: g.ciudad, provincia: g.provincia, cp: g.cp });
  if (!v.ok) return null;
  try {
    const existentes = await listarDirecciones(userId);
    const misma = existentes.find((d) => claveTexto(d.calle) === claveTexto(calle) && claveTexto(d.ciudad) === claveTexto(g.ciudad));
    const d = misma ?? (await crearDireccion(userId, v.datos, { lat: g.lat, lon: g.lon }));
    const eleccion = armarEleccion({
      tipo: "envio",
      localidad: d.ciudad,
      provincia: claveProvincia(d.provincia),
      cp: d.cp,
      direccionId: d.id,
    });
    return eleccion ? respuestaConEleccion(eleccion) : null;
  } catch (err) {
    if (!(err instanceof DireccionesLlenasError)) {
      console.error("[ubicacion] no se pudo guardar la dirección:", err instanceof Error ? err.message : "error");
    }
    return null;
  }
}

/**
 * Calle elegida de una sugerencia de `/api/geocode`: vale sólo con el flag y un token vigente de esa misma
 * calle. Devuelve lo que guarda la cookie (calle, CP, zona y token); las coordenadas quedan dentro del token.
 */
async function puntoExacto(
  calle: unknown,
  geoToken: unknown,
  provinciaClave: string,
  localidad: string,
): Promise<{ calle: string; cp?: string; zona?: string; geoToken: string } | null> {
  if (typeof calle !== "string" || typeof geoToken !== "string") return null;
  if (!(await envioPorZonaHabilitado())) return null;
  const g = verificarGeo(geoToken, { calle });
  if (!g) return null;
  let zona: string | null = null;
  try {
    const metodos = (await leerConfigEnvio(undefined, { conMetodos: true })).metodos ?? [];
    zona = zonaDelPunto(metodos, provinciaClave, localidad, g.cp, g.lat, g.lon, g.precision);
  } catch (err) {
    console.error("[ubicacion] no se pudieron leer los métodos de envío:", err instanceof Error ? err.message : "error");
  }
  return { calle, geoToken, ...(g.cp ? { cp: g.cp } : {}), ...(zona ? { zona } : {}) };
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_UBICACION);
  return res;
}
