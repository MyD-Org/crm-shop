import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { esIdDireccion } from "@/lib/direcciones-envio";
import { listarDirecciones } from "@/lib/direcciones-envio-db";
import { GeorefError, localidadPorId } from "@/lib/georef";
import { permitir } from "@/lib/rate-limit";
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
 *  - `{ id, cp? }`: una localidad de Georef. El servidor la vuelve a resolver por id (no confía en
 *    la provincia que mande el cliente). Sin sesión el código postal es obligatorio.
 *  - `{ direccionId }`: una dirección guardada. Exige sesión y que sea del usuario.
 *  - `{ tipo: "retiro", sucursal? }`: retiro en un local (sin `sucursal` sólo con el flag
 *    `sucursales` apagado: local único).
 * Cada rama valida y arma la cookie `shop_ubicacion` en el servidor; el cliente sólo manda ids. La
 * nueva elección reemplaza por completo a la anterior. DELETE: borra la cookie.
 */
const MAX_POR_MINUTO = 20;

const invalida = () => errorUbicacion(TEXTOS_UBICACION.invalida, 400);

export async function POST(req: Request) {
  if (!permitir(`ubicacion-elegir:${ipDe(req)}`, MAX_POR_MINUTO, 60_000)) return demasiadasConsultas();

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalida();
  const b = body as Record<string, unknown>;

  const conId = b.id !== undefined;
  const conDireccion = b.direccionId !== undefined;
  const conTipo = b.tipo !== undefined;
  // Un solo payload por pedido: mezclar ramas es un pedido inválido.
  if ([conId, conDireccion, conTipo].filter(Boolean).length !== 1) return invalida();
  if (conTipo && (b.tipo !== "retiro" || b.id !== undefined || b.cp !== undefined)) return invalida();
  if (conDireccion && b.cp !== undefined) return invalida();

  if (conTipo) return elegirRetiro(b.sucursal);
  if (conDireccion) return elegirDireccion(b.direccionId);
  return elegirLocalidad(b.id, b.cp);
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

async function elegirLocalidad(id: unknown, cpEntrada: unknown): Promise<NextResponse> {
  if (typeof id !== "string" || !/^\d{1,12}$/.test(id)) return invalida();

  let cp: string | undefined;
  if (cpEntrada !== undefined && cpEntrada !== null) {
    const n = normalizarCp(cpEntrada);
    if (!n) return errorUbicacion(TEXTOS_UBICACION.cpInvalido, 400);
    cp = n;
  } else {
    // Con sesión el código postal sale de la dirección guardada: no se pide aparte. Sin sesión, sí.
    const { userId } = await auth();
    if (!userId) return errorUbicacion(TEXTOS_UBICACION.cpRequerido, 400);
  }

  try {
    const loc = await localidadPorId(id);
    const ubicacion = loc && armarUbicacion(loc);
    if (!ubicacion) return errorUbicacion(TEXTOS_UBICACION.sinResultados, 404);
    return respuestaConEleccion({ tipo: "envio", ...ubicacion, ...(cp ? { cp } : {}) });
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
