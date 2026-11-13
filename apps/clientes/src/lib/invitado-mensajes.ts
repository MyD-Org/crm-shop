/**
 * Textos de error que la API devuelve en la compra del invitado (change `compra-como-invitado`).
 * Todos en español formal de usted (regla de textos de UI del repo). Viven juntos para poder
 * auditarlos con un test (sin tú / vos / «ojo»…).
 */
export const MENSAJES_INVITADO = {
  /** Turnstile ausente, vencido o rechazado. */
  verificacion: "No pudimos verificar la solicitud. Inténtelo nuevamente.",
  /** Origen cruzado o tipo de contenido que no es JSON. */
  solicitudInvalida: "No pudimos procesar la solicitud.",
  /** Más de lo que hace una persona: por minuto o por día desde la misma conexión. */
  demasiadosIntentos: "Hizo demasiados intentos de confirmar el pedido. Espere unos minutos e inténtelo de nuevo.",
  emailInvalido: "Ingrese un correo electrónico válido.",
  emailsDistintos: "Los correos electrónicos no coinciden.",
  telefonoInvalido: "Ingrese un teléfono válido, con código de área.",
  /** Tope de pedidos pendientes de pago por email. */
  pendientesTope:
    "Ya tiene pedidos pendientes de pago. Páguelos con el enlace «Pagar su pedido» que le enviamos por correo o comuníquese con el local.",
  /** Falta configuración del servidor (Turnstile o el secreto del pedido): la compra sin cuenta no se ofrece. */
  noDisponible: "La compra sin cuenta no está disponible por el momento. Inicie sesión o inténtelo más tarde.",
  /** Token de compra vencido: se lo lleva al enlace del mail. */
  tokenVencido: "Su sesión de compra venció. Para continuar, use el enlace «Pagar su pedido» que le enviamos por correo.",
  /** Límite de consultas del pedido de invitado. */
  limiteConsultas: "Demasiadas consultas. Espere unos minutos.",
  /** El invitado no cancela: contacta al local. */
  sinCancelar: "Este pedido no se puede cancelar desde la tienda. Comuníquese con el local.",
  /** Cuerpo que no es un objeto JSON. */
  cuerpoInvalido: "Body inválido",
} as const;

export type MotivoInvitado =
  | "pendientes_tope"
  | "token_vencido"
  | "invitado_no_disponible"
  | "verificacion_fallida"
  | "invitado_sin_cancelar";
