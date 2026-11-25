/**
 * El checkout parte de la elección de «Enviar a» del visitante y la mantiene al día. Lógica pura
 * (sin React) para poder probarla sin DOM.
 *
 * - `estadoInicialCheckout`: valores iniciales de entrega, local y dirección. Una elección vencida
 *   (dirección borrada, local que ya no existe) cae al valor de siempre, sin error.
 * - `cuerpoDeSincronizacion`: qué escribir en la cookie cuando el comprador cambia la entrega, el
 *   local o la dirección guardada. «Otra dirección para esta compra» y el domicilio fiscal no se
 *   sincronizan (no hay `direccionId` que guardar).
 * - `sincronizarUbicacion`: POST /api/ubicacion sin esperar ni propagar errores: la cookie es una
 *   comodidad y nunca frena la compra.
 */
import { OTRA_DIRECCION, eleccionInicial, type DireccionEnvio } from "./direcciones-envio";
import type { CuerpoEleccion } from "./enviar-a";
import { normalizarCp } from "./ubicacion";

export type OpcionEntregaCheckout = "retiro" | "domicilio";

/** Lo que la página del checkout recibe de `ubicacionDelVisitante` (solo identificadores). */
export interface EleccionInicialCheckout {
  tipo: "envio" | "retiro" | "ninguna";
  direccionId?: string;
  /** Slug del local de retiro; ausente en retiro = local único (flag `sucursales` apagado). */
  sucursal?: string;
  /** Provincia (clave) de la elección de envío. */
  provincia?: string;
  /** «Usar mi ubicación» con el envío por zona: dirección ya verificada (token vigente) para precargar. */
  exacta?: { calle: string; localidad: string; cp?: string; geoToken: string; precision: "altura" | "calle" };
  /** Localidad elegida en «Enviar a» (texto). Para arrancar la ciudad de «otra dirección». */
  localidad?: string;
  /** Código postal de la elección, si se conoce. */
  cp?: string;
}

/**
 * Ciudad y código postal con que arranca «otra dirección» a partir de la elección de «Enviar a»: el comprador
 * ya dijo adónde se envía y no tiene que volver a escribirlo (además, la ciudad acota el autocompletado de la
 * calle a su localidad). Sólo con envío elegido, sin dirección guardada elegida y sin direcciones guardadas:
 * con una guardada el formulario no se usa. Vacío = como siempre.
 */
export function entregaInicialDeEleccion(
  eleccion: EleccionInicialCheckout | null | undefined,
  direccionesGuardadas: number,
): { ciudad: string; cp: string } {
  if (eleccion?.tipo !== "envio" || eleccion.direccionId || direccionesGuardadas > 0) return { ciudad: "", cp: "" };
  return { ciudad: eleccion.localidad?.trim() ?? "", cp: normalizarCp(eleccion.cp) ?? "" };
}

/**
 * Código postal de una sugerencia del autocompletado, sólo si es válido (4 dígitos o CPA): el geocodificador
 * puede devolver formatos que el formulario después rechazaría. null = no se completa nada.
 */
export function cpDeSugerencia(cp: string | null | undefined): string | null {
  return normalizarCp(cp);
}

export interface EntradaEstadoInicial {
  eleccion?: EleccionInicialCheckout | null;
  direcciones: DireccionEnvio[];
  envioOfrecido: boolean;
  /** Slugs de los locales de retiro (vacío con el flag `sucursales` apagado). */
  locales: string[];
  localInicial: string | null;
  provinciaInicial: string | null;
}

export interface EstadoInicialCheckout {
  opcionEntrega: OpcionEntregaCheckout;
  localRetiro: string;
  eleccionDireccion: string;
  provinciaManual: string;
}

export function estadoInicialCheckout(e: EntradaEstadoInicial): EstadoInicialCheckout {
  const { eleccion } = e;
  const aEnvio = eleccion?.tipo === "envio" && e.envioOfrecido;

  const sucursalElegida =
    eleccion?.tipo === "retiro" && eleccion.sucursal && e.locales.includes(eleccion.sucursal)
      ? eleccion.sucursal
      : null;

  const direccionElegida =
    eleccion?.tipo === "envio" && eleccion.direccionId && e.direcciones.some((d) => d.id === eleccion.direccionId)
      ? eleccion.direccionId
      : null;

  return {
    opcionEntrega: aEnvio ? "domicilio" : "retiro",
    localRetiro: sucursalElegida ?? e.localInicial ?? "",
    eleccionDireccion: direccionElegida ?? eleccionInicial(e.direcciones),
    provinciaManual: (eleccion?.tipo === "envio" ? eleccion.provincia : undefined) ?? e.provinciaInicial ?? "",
  };
}

export interface EntradaSincronizacion {
  opcionEntrega: OpcionEntregaCheckout;
  localRetiro: string;
  eleccionDireccion: string;
  direcciones: DireccionEnvio[];
  /** Hay locales de retiro elegibles (flag `sucursales` prendido). */
  conSucursales: boolean;
  /** Envía al domicilio fiscal: no hay dirección guardada que recordar. */
  usarFiscal: boolean;
}

export function cuerpoDeSincronizacion(e: EntradaSincronizacion): CuerpoEleccion | null {
  if (e.opcionEntrega === "retiro") {
    return e.conSucursales && e.localRetiro ? { tipo: "retiro", sucursal: e.localRetiro } : { tipo: "retiro" };
  }
  if (e.usarFiscal || e.eleccionDireccion === OTRA_DIRECCION) return null;
  return e.direcciones.some((d) => d.id === e.eleccionDireccion) ? { direccionId: e.eleccionDireccion } : null;
}

/** Fire-and-forget: ni un fallo de red ni un 4xx llegan al checkout. */
export async function sincronizarUbicacion(f: typeof fetch, cuerpo: CuerpoEleccion): Promise<void> {
  try {
    await f("/api/ubicacion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      keepalive: true,
    });
  } catch {
    // La cookie es una comodidad: el estado del checkout es el que manda al crear el pedido.
  }
}
