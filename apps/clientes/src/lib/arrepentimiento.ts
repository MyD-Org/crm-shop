/**
 * Botón de arrepentimiento (Res. 424/2020): reglas puras del formulario de
 * `/arrepentimiento`. Sin base ni red: las usan la server action
 * (`arrepentimiento-acciones.ts`) y el form del cliente, y se testean solas.
 */

/** Campo trampa (honeypot): invisible para personas, los bots lo llenan. */
export const CAMPO_TRAMPA = "sitio_web";

/** Un envío más rápido que esto desde que se pintó el form no lo hizo una persona. */
export const MIN_LLENADO_MS = 3_000;
/** Un form pintado hace más de un día se recarga (la marca de tiempo ya no dice nada). */
export const MAX_LLENADO_MS = 24 * 60 * 60_000;

/** Rate limit en memoria por IP (`src/lib/rate-limit.ts`). */
export const MAX_POR_IP = 5;
export const VENTANA_IP_MS = 10 * 60_000;

/** Tope en la base por email (ya normalizado). */
export const MAX_POR_EMAIL = 3;
export const VENTANA_EMAIL_MS = 24 * 60 * 60_000;

/** Iguales al CHECK `sa_largos` de la migración 0016. */
export const LARGOS = { nombre: 120, email: 254, telefono: 40, pedido: 40, motivo: 1000 } as const;

export type CamposArrepentimiento = {
  nombre: string;
  email: string;
  telefono: string;
  pedido: string;
  motivo: string;
};

export type ErroresArrepentimiento = Partial<Record<keyof CamposArrepentimiento, string>>;

export type EstadoArrepentimiento =
  | { estado: "inicial" }
  | { estado: "error"; mensaje?: string; errores: ErroresArrepentimiento; valores: CamposArrepentimiento }
  | { estado: "ok"; codigo: string; email: string; mailCliente: boolean };

/** Mismo criterio que el resto del Shop (`comprobantes/mail.ts`). */
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** 42 → "ARR-000042". Con más de 6 cifras no se trunca. */
export function formatearCodigoArrepentimiento(numero: number): string {
  return `ARR-${String(numero).padStart(6, "0")}`;
}

function texto(fd: FormData, nombre: string): string {
  const v = fd.get(nombre);
  return typeof v === "string" ? v.trim() : "";
}

export function leerCampos(fd: FormData): CamposArrepentimiento {
  return {
    nombre: texto(fd, "nombre"),
    email: texto(fd, "email").toLowerCase(),
    telefono: texto(fd, "telefono"),
    pedido: texto(fd, "pedido"),
    motivo: texto(fd, "motivo"),
  };
}

const ETIQUETAS: Record<keyof CamposArrepentimiento, string> = {
  nombre: "El nombre",
  email: "El email",
  telefono: "El teléfono",
  pedido: "El número de pedido",
  motivo: "El motivo",
};

/** Errores por campo, en usted. `{}` = válido. Pedido y motivo son opcionales. */
export function validarCampos(c: CamposArrepentimiento): ErroresArrepentimiento {
  const errores: ErroresArrepentimiento = {};
  if (!c.nombre) errores.nombre = "Ingrese su nombre.";
  if (!c.email) errores.email = "Ingrese su email.";
  else if (!EMAIL_VALIDO.test(c.email)) errores.email = "Ingrese un email válido.";
  if (!c.telefono) errores.telefono = "Ingrese su teléfono.";

  for (const campo of Object.keys(LARGOS) as (keyof CamposArrepentimiento)[]) {
    if (!errores[campo] && c[campo].length > LARGOS[campo]) {
      errores[campo] = `${ETIQUETAS[campo]} supera los ${LARGOS[campo]} caracteres.`;
    }
  }
  return errores;
}

/** ¿El form tardó lo que tarda una persona? `iniciado` = epoch ms que pintó el servidor. */
export function llenadoValido(iniciado: string | null, ahora: number): boolean {
  if (!iniciado) return false;
  const desde = Number(iniciado);
  if (!Number.isFinite(desde)) return false;
  const transcurrido = ahora - desde;
  return transcurrido >= MIN_LLENADO_MS && transcurrido <= MAX_LLENADO_MS;
}
