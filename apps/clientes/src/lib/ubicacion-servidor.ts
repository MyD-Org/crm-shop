/**
 * Lectura de la ubicación del visitante en el server. Lee el request (cookie e identidad), así que
 * va SIEMPRE fuera de los scopes cacheados y dentro de un hueco por request (Suspense).
 *
 * Es el ÚNICO punto de lectura de la cookie `shop_ubicacion` y la valida siempre: una dirección
 * guardada tiene que ser del usuario actual y un local de retiro tiene que estar activo y aceptar
 * retiro. Lo ajeno, borrado o vencido se ignora y cae a la dirección predeterminada (con sesión) o
 * a "ninguna". Nunca cae implícitamente en "retiro". Una falla al leer no rompe nada.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { identidadActual } from "./auth";
import { listarDirecciones } from "./direcciones-envio-db";
import type { DireccionEnvio } from "./direcciones-envio";
import { retiroValido } from "./ubicacion-retiro";
import { claveProvincia } from "./sucursales";
import {
  COOKIE_UBICACION,
  armarUbicacion,
  validarCookieUbicacion,
  type EleccionCruda,
  type EleccionUbicacion,
  type OrigenUbicacion,
  type UbicacionVisitante,
} from "./ubicacion";

export interface UbicacionResuelta {
  /** Localidad/provincia para los consumidores de provincia (zona, envío); null si no hay. */
  ubicacion: UbicacionVisitante | null;
  origen: OrigenUbicacion;
  /** Elección ya validada contra el dueño y las sucursales. */
  eleccion: EleccionUbicacion;
  /** Para el rótulo "Enviar a {nombre}"; null sin sesión. */
  nombrePila: string | null;
}

type EleccionEnvio = Extract<EleccionUbicacion, { tipo: "envio" }>;

function envioDeDireccion(d: DireccionEnvio): EleccionEnvio {
  return {
    tipo: "envio",
    direccion: { id: d.id, calle: d.calle, ciudad: d.ciudad, cp: d.cp, etiqueta: d.etiqueta },
    localidad: d.ciudad,
    provincia: claveProvincia(d.provincia) || null,
    ...(d.cp ? { cp: d.cp } : {}),
  };
}

/** Localidad/provincia de una dirección guardada, si sirven como ubicación. */
function ubicacionDeDireccion(d: DireccionEnvio): UbicacionVisitante | null {
  return armarUbicacion({ localidad: d.ciudad, provincia: claveProvincia(d.provincia) });
}

export const ubicacionDelVisitante = cache(async (): Promise<UbicacionResuelta> => {
  const cruda: EleccionCruda | null = validarCookieUbicacion((await cookies()).get(COOKIE_UBICACION)?.value);

  let clerkUserId: string | null = null;
  let nombrePila: string | null = null;
  let direcciones: DireccionEnvio[] = [];
  try {
    const identidad = await identidadActual();
    clerkUserId = identidad.clerkUserId;
    nombrePila = identidad.nombrePila ?? null;
    if (clerkUserId) direcciones = await listarDirecciones(clerkUserId);
  } catch (err) {
    console.error("[ubicacion] no se pudieron leer las direcciones guardadas:", err);
  }

  const ninguna = (): UbicacionResuelta => ({
    ubicacion: null,
    origen: "ninguna",
    eleccion: { tipo: "ninguna" },
    nombrePila,
  });

  /** Sin elección válida: predeterminada (o primera) con sesión; si no, ninguna. */
  const porDefecto = (): UbicacionResuelta => {
    const d = direcciones.find((x) => x.predeterminada) ?? direcciones[0];
    if (!d) return ninguna();
    const u = ubicacionDeDireccion(d);
    return {
      ubicacion: u,
      origen: u ? "direccion" : "ninguna",
      eleccion: envioDeDireccion(d),
      nombrePila,
    };
  };

  if (!cruda) return porDefecto();

  if (cruda.tipo === "retiro") {
    const retiro = await retiroValido(cruda);
    if (!retiro) return porDefecto();
    const s = retiro.sucursal;
    // La ubicación de un retiro es la del local (derivada, no guardada): zona y provincia siguen andando.
    const ubicacion = s ? armarUbicacion({ localidad: s.ciudad, provincia: claveProvincia(s.provincia) }) : null;
    return { ubicacion, origen: "cookie", eleccion: retiro, nombrePila };
  }

  // Envío.
  if (cruda.direccionId && clerkUserId) {
    const d = direcciones.find((x) => x.id === cruda.direccionId);
    // Ajena, borrada o de otra sesión: se ignora la cookie entera (sin exponer nada de esa dirección).
    if (!d) return porDefecto();
    const u = ubicacionDeDireccion(d);
    return {
      ubicacion: u ?? { localidad: cruda.localidad, provincia: cruda.provincia },
      origen: "cookie",
      eleccion: envioDeDireccion(d),
      nombrePila,
    };
  }

  // Sin dirección guardada (o sin sesión: el id no vale): localidad/provincia/cp de la cookie.
  const { tipo: _tipo, direccionId: _id, ...resto } = cruda;
  void _tipo;
  void _id;
  const ubicacion: UbicacionVisitante = {
    localidad: resto.localidad,
    provincia: resto.provincia,
    ...(resto.id ? { id: resto.id } : {}),
    ...(resto.cp ? { cp: resto.cp } : {}),
  };
  return {
    ubicacion,
    origen: "cookie",
    eleccion: {
      tipo: "envio",
      localidad: resto.localidad,
      provincia: resto.provincia,
      ...(resto.cp ? { cp: resto.cp } : {}),
    },
    nombrePila,
  };
});
