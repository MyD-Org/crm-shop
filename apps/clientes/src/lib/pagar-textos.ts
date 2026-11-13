/**
 * Textos de `/pagar/[token]` (change `compra-como-invitado`, S3). Español formal de usted; viven
 * juntos para poder auditarlos con un test.
 */
export const TEXTOS_PAGAR = {
  /** Una sola respuesta para todo lo que no se puede pagar: no revela si el pedido existe. */
  noDisponibleTitulo: "Enlace no disponible",
  noDisponible: "Este enlace ya no está disponible. Comuníquese con el local.",
  pagadoTitulo: "Pedido pagado",
  pagado: "Este pedido ya fue pagado.",
  limiteTitulo: "Demasiadas consultas",
  limite: "Hizo demasiados intentos. Espere unos minutos e inténtelo de nuevo.",
  verCatalogo: "Ver catálogo",
} as const;

/** Cuenta del invitado al terminar la compra (CTA «Cree su cuenta»). */
export const TEXTOS_CREAR_CUENTA = {
  titulo: "Cree su cuenta",
  descripcion:
    "Con el correo electrónico de este pedido (puede usar Google o una contraseña) sus pedidos quedarán asociados a su cuenta y podrá seguirlos en Mi cuenta.",
  asociacion: "Los pedidos hechos con este correo en los últimos 30 días se asociarán a su cuenta.",
  boton: "Crear mi cuenta",
} as const;
