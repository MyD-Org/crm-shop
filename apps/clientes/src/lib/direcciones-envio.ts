/**
 * Direcciones de envío guardadas en Mi cuenta: tipos, validación y vista.
 *
 * Módulo PURO: lo importan el formulario de Mi cuenta y el selector del
 * checkout (client components) y la API (servidor), con las mismas reglas. La
 * persistencia está en `direcciones-envio-db.ts`.
 *
 * Se puede guardar cualquier dirección de la Argentina. Si la localidad queda
 * fuera de la zona de envío propio (`ciudadConEnvio` de `envio.ts`, la única
 * definición) se guarda igual y se avisa que el envío se coordina por
 * separado. El checkout la lista, pero no la acepta para envío a domicilio
 * mientras la zona siga limitada.
 */
import { CIUDADES_ENVIO, ciudadConEnvio } from "./envio";
import { provinciaCanonica } from "./provincias";

/** Tope de direcciones por usuario (decisión del usuario). */
export const MAX_DIRECCIONES = 10;

/** Largo máximo de cada campo de texto. */
export const LARGOS_DIRECCION = {
  etiqueta: 40,
  calle: 120,
  ciudad: 80,
  referencias: 200,
} as const;

/** Largo que acepta `POST /api/pedidos` para `entregaDireccion`. */
const MAX_LINEA_ENTREGA = 200;

export type CampoDireccion = "etiqueta" | "calle" | "ciudad" | "provincia" | "cp" | "referencias";

/** Lo que manda el formulario, ya validado y normalizado. */
export interface DatosDireccion {
  etiqueta: string | null;
  calle: string;
  ciudad: string;
  provincia: string;
  cp: string;
  referencias: string | null;
  /** Pedido de dejarla como predeterminada (sólo `true` explícito). */
  predeterminada: boolean;
}

/** Una dirección guardada, como la ven la UI y la API. */
export interface DireccionEnvio {
  id: string;
  etiqueta: string | null;
  calle: string;
  ciudad: string;
  /** Nullable en la base; la API la exige al guardar. */
  provincia: string | null;
  cp: string | null;
  referencias: string | null;
  predeterminada: boolean;
}

export type ResultadoValidacion =
  | { ok: true; datos: DatosDireccion }
  /** El cuerpo no es un objeto JSON: la API responde 400. */
  | { ok: false; motivo: "cuerpo" }
  /** Algún campo no pasa: la API responde 422 con los mensajes por campo. */
  | { ok: false; motivo: "campos"; errores: Partial<Record<CampoDireccion, string>> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿Tiene forma de id de dirección? Si no, la API responde 404 sin consultar. */
export function esIdDireccion(id: string): boolean {
  return UUID.test(id);
}

/** CP de 4 dígitos o CPA (letra de provincia + 4 dígitos + 3 letras). */
const CP_VALIDO = /^(?:\d{4}|[A-Z]\d{4}[A-Z]{3})$/;

export function normalizarCp(cp: string): string {
  return cp.replace(/\s+/g, "").toUpperCase();
}

/** Texto recortado y con espacios internos colapsados; "" si no es string. */
function limpio(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

const MSJ_LARGO = (max: number) => `Use hasta ${max} caracteres.`;

export function validarDireccion(entrada: unknown): ResultadoValidacion {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) {
    return { ok: false, motivo: "cuerpo" };
  }
  const e = entrada as Record<string, unknown>;
  const errores: Partial<Record<CampoDireccion, string>> = {};

  const etiqueta = limpio(e.etiqueta);
  const calle = limpio(e.calle);
  const ciudad = limpio(e.ciudad);
  const provincia = provinciaCanonica(limpio(e.provincia));
  const cp = normalizarCp(limpio(e.cp));
  const referencias = limpio(e.referencias);

  if (etiqueta.length > LARGOS_DIRECCION.etiqueta) {
    errores.etiqueta = MSJ_LARGO(LARGOS_DIRECCION.etiqueta);
  }
  if (!calle) errores.calle = "Indique la calle y el número.";
  else if (calle.length > LARGOS_DIRECCION.calle) errores.calle = MSJ_LARGO(LARGOS_DIRECCION.calle);
  if (!ciudad) errores.ciudad = "Indique la localidad.";
  else if (ciudad.length > LARGOS_DIRECCION.ciudad) errores.ciudad = MSJ_LARGO(LARGOS_DIRECCION.ciudad);
  if (!provincia) errores.provincia = "Seleccione la provincia.";
  if (!cp) errores.cp = "Indique el código postal.";
  else if (!CP_VALIDO.test(cp)) errores.cp = "Indique un código postal válido (por ejemplo, 3370).";
  if (referencias.length > LARGOS_DIRECCION.referencias) {
    errores.referencias = MSJ_LARGO(LARGOS_DIRECCION.referencias);
  }

  if (Object.keys(errores).length > 0 || !provincia) {
    return { ok: false, motivo: "campos", errores };
  }
  return {
    ok: true,
    datos: {
      etiqueta: etiqueta || null,
      calle,
      ciudad,
      provincia,
      cp,
      referencias: referencias || null,
      predeterminada: e.predeterminada === true,
    },
  };
}

/** ¿La localidad queda fuera de la zona de envío propio de hoy? */
export function fueraDeZona(d: Pick<DireccionEnvio, "ciudad">): boolean {
  return ciudadConEnvio(d.ciudad) === null;
}

/** Aviso para una dirección fuera de la zona (Mi cuenta y checkout). */
export function avisoFueraDeZona(ciudad: string): string {
  return `El envío a ${ciudad} se coordina por separado: hoy enviamos a ${CIUDADES_ENVIO.join(" y ")}.`;
}

export function etiquetaDireccion(d: Pick<DireccionEnvio, "etiqueta">): string {
  return d.etiqueta || "Dirección";
}

/** Líneas para mostrar la dirección, sin huecos. */
export function lineasDireccion(d: DireccionEnvio): string[] {
  return [
    d.calle,
    [d.ciudad, d.provincia].filter(Boolean).join(", "),
    d.cp ? `CP ${d.cp}` : "",
    d.referencias ?? "",
  ].filter(Boolean);
}

/** Texto de una opción del selector de direcciones del checkout. */
export function opcionDireccion(d: DireccionEnvio): string {
  return `${etiquetaDireccion(d)}: ${d.calle}, ${d.ciudad}`;
}

/**
 * `entregaDireccion` del pedido para una dirección guardada. El pedido guarda
 * la ciudad aparte: acá van calle, CP, provincia y referencias, recortado al
 * largo que acepta la API.
 */
export function lineaEntrega(d: DireccionEnvio): string {
  const base = [d.calle, d.cp ? `CP ${d.cp}` : "", d.provincia ?? ""].filter(Boolean).join(", ");
  const linea = d.referencias ? `${base}. Referencias: ${d.referencias}` : base;
  return linea.length > MAX_LINEA_ENTREGA ? linea.slice(0, MAX_LINEA_ENTREGA) : linea;
}

/**
 * Ciudad y dirección que el checkout manda al pedido con una dirección
 * guardada. En zona, la ciudad sale escrita como en `CIUDADES_ENVIO` (la que
 * acepta `evaluarEnvio`); fuera de zona se manda tal cual y `evaluarEnvio` la
 * rechaza para envío, igual que hoy con cualquier ciudad fuera de la lista.
 */
export function entregaDesdeGuardada(d: DireccionEnvio): { ciudad: string; direccion: string } {
  return { ciudad: ciudadConEnvio(d.ciudad) ?? d.ciudad, direccion: lineaEntrega(d) };
}
