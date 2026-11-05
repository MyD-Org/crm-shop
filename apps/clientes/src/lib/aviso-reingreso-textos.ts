/**
 * Textos y topes del aviso de reingreso (change `aviso-reingreso`). Todo el texto visible va en
 * español formal de usted (CLAUDE.md raíz). Sin emojis; ejemplos y fixtures, siempre `.example`.
 */

/** Campo trampa (honeypot): invisible para personas, los bots lo llenan. */
export const CAMPO_TRAMPA = "sitio_web";

/** Un envío más rápido que esto desde que se pintó el form no lo hizo una persona. */
export const MIN_LLENADO_MS = 3_000;
/** Un form pintado hace más de un día se recarga. */
export const MAX_LLENADO_MS = 24 * 60 * 60_000;

/** Rate limit por IP (`lib/rate-limit.ts`, `permitirAsync`): 5 por hora. La IP no se guarda. */
export const MAX_POR_IP = 5;
export const VENTANA_IP_MS = 60 * 60_000;

/** Tope de avisos PENDIENTES por email en el tenant. */
export const MAX_PENDIENTES_POR_EMAIL = 10;

/** Cantidad deseada: entero entre 1 y 999 (CHECK `avisos_cantidad`). */
export const CANTIDAD_MIN = 1;
export const CANTIDAD_MAX = 999;

/** Iguales al CHECK `avisos_largos` de la migración 0043. */
export const LARGOS = { email: 254, whatsapp: 40, alegraId: 64 } as const;

/** Tope de intentos de envío por aviso, vencimiento del claim del cron, lote y retención (rebanada S2). */
export const MAX_INTENTOS = 5;
export const CLAIM_VENCE_MIN = 30;
export const LOTE_MAX = 200;
export const TANDA_DISPONIBILIDAD = 100;
export const RETENCION_DIAS = 180;
export const RETENCION_PENDIENTES_DIAS = 365;

export const TEXTOS = {
  boton: "Avisarme cuando ingrese",
  titulo: "Avisarme cuando ingrese",
  descripcion: "Déjenos su correo y le avisaremos cuando este producto vuelva a estar disponible.",
  etiquetaEmail: "Correo electrónico",
  /** Con sesión iniciada no se pide el correo: se usa el de la cuenta. */
  descripcionConCuenta: (email: string) =>
    `Le avisaremos a ${email} cuando este producto vuelva a estar disponible.`,
  etiquetaCantidad: "Cantidad que necesita",
  etiquetaEncargar: "Me interesa encargarlo",
  ayudaEncargar: "El local podrá contactarlo para coordinar el encargo. Esto no genera un pedido ni una reserva.",
  etiquetaWhatsapp: "WhatsApp (opcional)",
  etiquetaConsentimiento: "Acepto que el local me contacte por WhatsApp para coordinar el encargo.",
  enviar: "Avisarme",
  enviando: "Enviando…",
  cerrar: "Cancelar",
  aclaracion: "Sujeto a disponibilidad al momento de la compra. No reserva unidades ni fija el precio.",
  ok: "Listo. Le avisaremos por correo cuando vuelva a estar disponible.",
  okEncargar: "Listo. Le avisaremos por correo cuando vuelva a estar disponible y el local podrá contactarlo por el encargo.",
} as const;

export const ERRORES = {
  email: "Ingrese un correo válido.",
  emailLargo: `El correo supera los ${LARGOS.email} caracteres.`,
  cantidad: `Ingrese una cantidad entre ${CANTIDAD_MIN} y ${CANTIDAD_MAX}.`,
  whatsappLargo: `El WhatsApp supera los ${LARGOS.whatsapp} caracteres.`,
  consentimiento: "Para dejar su WhatsApp, acepte que el local lo contacte.",
  demasiados: "Demasiados intentos. Inténtelo más tarde.",
  topeEmail: "Ya tiene varios avisos pendientes con este correo. Cuando se resuelvan, podrá pedir otros.",
  noDisponible: "No es posible pedir el aviso para este producto.",
  generico: "No se pudo registrar el aviso. Inténtelo de nuevo en unos minutos.",
} as const;

/** Mail «Volvió a estar disponible» y página de baja (rebanada S2). */
export const MAIL = {
  asunto: (producto: string) => `Ya hay disponible: ${producto}`,
  titulo: "Volvió a estar disponible",
  bajada: (producto: string) => `El producto que nos consultó volvió a estar disponible: ${producto}.`,
  aclaracion: "Las unidades son limitadas y la disponibilidad está sujeta a stock al momento de la compra.",
  boton: "Ver producto",
  preheader: (producto: string) => `${producto} volvió a estar disponible.`,
  pieMotivo: "Recibe este mensaje porque pidió que le avisáramos cuando este producto volviera a estar disponible.",
  pieUnaVez: "Se lo enviamos una sola vez.",
  pieBaja: "Si ya no desea recibir este aviso, puede darse de baja:",
} as const;

export const BAJA = {
  titulo: "Baja del aviso de reingreso",
  descripcion: "Confirme si desea dejar de recibir el aviso de reingreso de este producto.",
  boton: "Confirmar baja",
  hecho: "Se dio de baja del aviso. No recibirá más correos sobre este producto.",
  invalido: "Este enlace no es válido o el aviso ya no existe.",
  error: "No se pudo procesar la baja. Inténtelo de nuevo en unos minutos.",
  volver: "Volver a la tienda",
} as const;
