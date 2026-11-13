/**
 * Formulario del invitado: estado, validación y cuerpo de `POST /api/pedidos` (change
 * `compra-como-invitado`, S2b). Lógica PURA (sin React ni fetch) para poder probarla.
 *
 * La validación de facturación es la MISMA del servidor (`resolverFacturacionInvitado`): el navegador
 * sólo adelanta el error; el servidor vuelve a validar todo.
 */
import { CAMPO_TRAMPA } from "./arrepentimiento";
import { telefonoValido } from "./facturacion";
import { resolverFacturacionInvitado, type ModoFacturacionInvitado } from "./facturacion-invitado";
import { ERRORES_INVITADO } from "./invitado-textos";

export interface DatosInvitado {
  email: string;
  emailConfirmacion: string;
  nombre: string;
  telefono: string;
  modo: ModoFacturacionInvitado;
  nroDoc: string;
  razonSocial: string;
  condicionIva: string;
  /** CP de la entrega (a domicilio) o del domicilio de facturación (retiro). */
  cp: string;
  /** Sólo en un retiro en el local: el domicilio de facturación. */
  calle: string;
  ciudad: string;
  provincia: string;
}

export const DATOS_INVITADO_VACIOS: DatosInvitado = {
  email: "",
  emailConfirmacion: "",
  nombre: "",
  telefono: "",
  modo: "consumidor_final",
  nroDoc: "",
  razonSocial: "",
  condicionIva: "",
  cp: "",
  calle: "",
  ciudad: "",
  provincia: "",
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailNormalizado = (v: string) => v.trim().toLowerCase();

/**
 * El email con el que se valida el cupón del invitado al cotizar: sólo uno válido y confirmado, así no
 * se recotiza en cada tecla ni se consulta el cupón con un email a medio escribir. "" = todavía no.
 */
export function emailParaCupon(d: Pick<DatosInvitado, "email" | "emailConfirmacion">): string {
  const e = emailNormalizado(d.email);
  return EMAIL.test(e) && e === emailNormalizado(d.emailConfirmacion) ? e : "";
}

export interface EntregaInvitado {
  tipo: "envio" | "retiro";
  calle?: string;
  ciudad?: string;
  /** Ya canónica. */
  provincia?: string | null;
}

/** Errores de la parte de contacto (paso «Sus datos»). `{}` = válido. */
export function validarContactoInvitado(d: DatosInvitado): Record<string, string> {
  const e: Record<string, string> = {};
  if (!EMAIL.test(emailNormalizado(d.email))) e.email = ERRORES_INVITADO.emailInvalido;
  else if (emailNormalizado(d.email) !== emailNormalizado(d.emailConfirmacion)) {
    e.emailConfirmacion = ERRORES_INVITADO.emailsDistintos;
  }
  if (d.nombre.trim().length < 2) e.nombre = ERRORES_INVITADO.nombre;
  if (!telefonoValido(d.telefono)) e.telefono = ERRORES_INVITADO.telefono;
  return e;
}

/** El cuerpo `facturacionInvitado` que espera el servidor. */
export function cuerpoFacturacionInvitado(d: DatosInvitado, entrega: EntregaInvitado) {
  const esFacturaA = d.modo === "factura_a";
  return {
    modo: d.modo,
    nroDoc: d.nroDoc.trim(),
    ...(esFacturaA ? { razonSocial: d.razonSocial.trim(), condicionIva: d.condicionIva } : {}),
    domicilioCp: d.cp.trim(),
    // En un retiro el domicilio de facturación va en el mismo bloque; con envío es el de la entrega.
    ...(entrega.tipo === "retiro"
      ? { domicilioCalle: d.calle.trim(), domicilioCiudad: d.ciudad.trim(), domicilioProvincia: d.provincia }
      : {}),
  };
}

/** Error de facturación (el primero, en usted) y el campo al que corresponde, o null si el servidor la aceptaría. */
export function erroresFacturacionInvitado(
  d: DatosInvitado,
  entrega: EntregaInvitado,
): { error: string; campo: string } | null {
  const r = resolverFacturacionInvitado(cuerpoFacturacionInvitado(d, entrega), entrega, d.nombre);
  return r.ok ? null : { error: r.error, campo: r.campos[0] ?? "modo" };
}

/** ¿Se puede confirmar? Contacto y facturación válidos. */
export function invitadoCompleto(d: DatosInvitado, entrega: EntregaInvitado): boolean {
  return Object.keys(validarContactoInvitado(d)).length === 0 && erroresFacturacionInvitado(d, entrega) === null;
}

/** Los campos extra de `POST /api/pedidos` para el invitado. */
export function camposDeInvitadoParaPedido(
  d: DatosInvitado,
  entrega: EntregaInvitado,
  verificacion: { turnstile: string; iniciado: number; trampa?: string },
) {
  return {
    email: d.email.trim(),
    emailConfirmacion: d.emailConfirmacion.trim(),
    facturacionInvitado: cuerpoFacturacionInvitado(d, entrega),
    turnstile: verificacion.turnstile,
    iniciado: verificacion.iniciado,
    [CAMPO_TRAMPA]: verificacion.trampa ?? "",
  };
}
