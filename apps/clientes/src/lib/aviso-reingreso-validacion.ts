/**
 * Reglas puras del formulario de aviso de reingreso. Sin base ni red: las usan la server action y el
 * form del cliente, y se testean solas.
 */
import { CANTIDAD_MAX, CANTIDAD_MIN, ERRORES, LARGOS, MAX_LLENADO_MS, MIN_LLENADO_MS } from "./aviso-reingreso-textos";

/** Mismo criterio que el resto del Shop (`arrepentimiento.ts`). */
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface CamposAviso {
  /** Normalizado: trim + minúsculas. */
  email: string;
  cantidad: number;
  quiereEncargar: boolean;
  /** Solo con encargar tildado y consentimiento; si no, `null`. */
  whatsapp: string | null;
  consentimientoContacto: boolean;
}

export type ErroresAviso = Partial<Record<"email" | "cantidad" | "whatsapp" | "consentimiento", string>>;

function texto(fd: FormData, nombre: string): string {
  const v = fd.get(nombre);
  return typeof v === "string" ? v.trim() : "";
}

/** Casilla de HTML: presente ("on") = tildada. */
function tildado(fd: FormData, nombre: string): boolean {
  const v = fd.get(nombre);
  return typeof v === "string" && v !== "" && v !== "false";
}

/** Entero estricto ("2" sí; "2.5", "1e2", "" y "abc" no). */
export function leerCantidad(crudo: string): number {
  return /^\d{1,6}$/.test(crudo.trim()) ? Number(crudo.trim()) : Number.NaN;
}

/**
 * Lee los campos del `FormData`. El WhatsApp solo se conserva si la persona tildó "encargar" Y el
 * consentimiento: sin eso se descarta en silencio (nunca se guarda un número sin consentimiento).
 */
export function leerCamposAviso(fd: FormData): { campos: CamposAviso; whatsappCrudo: string } {
  const quiereEncargar = tildado(fd, "quiereEncargar");
  const consentimientoContacto = quiereEncargar && tildado(fd, "consentimientoContacto");
  const whatsappCrudo = texto(fd, "whatsapp");
  return {
    campos: {
      email: texto(fd, "email").toLowerCase(),
      cantidad: leerCantidad(texto(fd, "cantidad")),
      quiereEncargar,
      whatsapp: consentimientoContacto && whatsappCrudo ? whatsappCrudo : null,
      consentimientoContacto,
    },
    whatsappCrudo,
  };
}

/** Errores por campo, en usted. `{}` = válido. */
export function validarCamposAviso(c: CamposAviso, whatsappCrudo = c.whatsapp ?? ""): ErroresAviso {
  const errores: ErroresAviso = {};
  if (!c.email || !EMAIL_VALIDO.test(c.email)) errores.email = ERRORES.email;
  else if (c.email.length > LARGOS.email) errores.email = ERRORES.emailLargo;

  if (!Number.isInteger(c.cantidad) || c.cantidad < CANTIDAD_MIN || c.cantidad > CANTIDAD_MAX) {
    errores.cantidad = ERRORES.cantidad;
  }
  if (whatsappCrudo.length > LARGOS.whatsapp) errores.whatsapp = ERRORES.whatsappLargo;
  if (whatsappCrudo && c.quiereEncargar && !c.consentimientoContacto) errores.consentimiento = ERRORES.consentimiento;
  return errores;
}

/** ¿El form tardó lo que tarda una persona? `iniciado` = epoch ms en que se abrió el form. */
export function llenadoValido(iniciado: string | null, ahora: number): boolean {
  if (!iniciado) return false;
  const desde = Number(iniciado);
  if (!Number.isFinite(desde)) return false;
  const transcurrido = ahora - desde;
  return transcurrido >= MIN_LLENADO_MS && transcurrido <= MAX_LLENADO_MS;
}

export type EstadoAviso =
  | { estado: "inicial" }
  | { estado: "error"; mensaje?: string; errores: ErroresAviso }
  | { estado: "ok"; encargar: boolean };
