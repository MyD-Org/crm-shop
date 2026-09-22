/**
 * Lógica pura del formulario de direcciones de Mi cuenta (client component):
 * pasar de una dirección guardada al formulario, aplicar el atajo "usar la
 * misma dirección de facturación" o una sugerencia del geocodificador, y leer
 * la respuesta de la API. Sin React ni fetch, para poder probarla.
 */
import { ETIQUETA_FACTURACION, yaUsaDireccion, type DireccionPrellenada } from "./direccion-envio";
import type { CampoDireccion, DireccionEnvio } from "./direcciones-envio";
import { provinciaCanonica } from "./provincias";

export interface FormularioDireccion {
  etiqueta: string;
  calle: string;
  ciudad: string;
  provincia: string;
  cp: string;
  referencias: string;
  predeterminada: boolean;
}

export const FORMULARIO_VACIO: FormularioDireccion = {
  etiqueta: "",
  calle: "",
  ciudad: "",
  provincia: "",
  cp: "",
  referencias: "",
  predeterminada: false,
};

export function formularioDesde(d: DireccionEnvio): FormularioDireccion {
  return {
    etiqueta: d.etiqueta ?? "",
    calle: d.calle,
    ciudad: d.ciudad,
    provincia: d.provincia ?? "",
    cp: d.cp ?? "",
    referencias: d.referencias ?? "",
    predeterminada: d.predeterminada,
  };
}

/** Atajo "usar la misma dirección de facturación". */
export function conFacturacion(
  f: FormularioDireccion,
  fact: DireccionPrellenada,
): FormularioDireccion {
  return {
    ...f,
    etiqueta: f.etiqueta || ETIQUETA_FACTURACION,
    calle: fact.calle,
    ciudad: fact.ciudad,
    provincia: provinciaCanonica(fact.provincia) ?? "",
    cp: fact.cp,
  };
}

/** Sugerencia elegida en el autocompletado: sólo pisa lo que trae. */
export function conSugerencia(
  f: FormularioDireccion,
  s: { calle: string; ciudad: string; provincia: string; cp: string },
): FormularioDireccion {
  return {
    ...f,
    calle: s.calle || f.calle,
    ciudad: s.ciudad || f.ciudad,
    provincia: provinciaCanonica(s.provincia) ?? f.provincia,
    cp: s.cp || f.cp,
  };
}

/**
 * ¿Se ofrece el atajo de facturación? No sin domicilio fiscal, ni cuando OTRA
 * dirección guardada ya usa esa calle (al editar esa misma, sí).
 */
export function ofrecerFacturacion(
  fact: DireccionPrellenada | null,
  guardadas: DireccionEnvio[],
  editandoId: string | null,
): boolean {
  if (!fact) return false;
  const otras = guardadas.filter((d) => d.id !== editandoId).map((d) => d.calle);
  return !yaUsaDireccion(fact, otras);
}

export type RespuestaDirecciones =
  | { ok: true; direcciones: DireccionEnvio[] }
  | { ok: false; error: string; errores: Partial<Record<CampoDireccion, string>> };

const ERROR_GENERICO = "No pudimos guardar los cambios. Inténtelo de nuevo.";

/** Lee la respuesta de cualquier ruta de `/api/mi-cuenta/direcciones`. */
export function interpretarRespuesta(status: number, cuerpo: unknown): RespuestaDirecciones {
  const c = (cuerpo ?? {}) as {
    direcciones?: unknown;
    error?: unknown;
    errores?: unknown;
  };
  if (status >= 200 && status < 300 && Array.isArray(c.direcciones)) {
    return { ok: true, direcciones: c.direcciones as DireccionEnvio[] };
  }
  if (status === 401) {
    return {
      ok: false,
      error: "Su sesión venció. Vuelva a iniciar sesión para guardar sus direcciones.",
      errores: {},
    };
  }
  return {
    ok: false,
    error: typeof c.error === "string" && status >= 400 ? c.error : ERROR_GENERICO,
    errores:
      typeof c.errores === "object" && c.errores !== null
        ? (c.errores as Partial<Record<CampoDireccion, string>>)
        : {},
  };
}
