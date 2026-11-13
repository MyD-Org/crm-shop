/**
 * Textos de la compra como invitado (change `compra-como-invitado`). Todo en español formal de
 * usted (regla de textos de UI del repo). Viven juntos para poder auditarlos con un test.
 */
export const TEXTOS_INVITADO = {
  tituloDatos: "Sus datos",
  introDatos: "Compre sin crear una cuenta. Le enviaremos el detalle del pedido por correo electrónico.",
  email: "Correo electrónico",
  emailConfirmacion: "Repita su correo electrónico",
  nombre: "Nombre y apellido",
  telefono: "Teléfono",
  telefonoAyuda: "Con código de área. Lo usamos para coordinar la entrega.",
  tituloFacturacion: "Facturación",
  consumidorFinal: "Consumidor final",
  consumidorFinalDescripcion: "Factura B a su nombre, con su DNI",
  facturaA: "Factura A",
  facturaADescripcion: "Con el CUIT de su empresa o su monotributo",
  dni: "DNI",
  cuit: "CUIT",
  razonSocial: "Razón social",
  condicionIva: "Condición frente al IVA",
  condicionIvaPlaceholder: "Seleccionar condición",
  tituloDomicilio: "Domicilio de facturación",
  domicilioIntro: "Va en la factura. Para el retiro en el local lo necesitamos igual.",
  codigoPostal: "Código postal",
  codigoPostalEntrega: "Código postal de la entrega",
  calle: "Calle y número",
  ciudad: "Ciudad",
  provincia: "Provincia",
  provinciaPlaceholder: "Seleccionar provincia",
  continuar: "Continuar",
  verificando: "Verificando…",
  verificacionPendiente: "Estamos verificando que usted es una persona. Aguarde un instante.",
  verificacionFallida: "No pudimos verificar la solicitud. Recargue la página e inténtelo nuevamente.",
  ingresar: "Ya tengo cuenta, ingresar",
  avisoCarrito: "Puede completar su compra sin crear una cuenta.",
  carritoTitulo: "Está comprando como invitado",
  carritoAyuda: "Puede completar su compra sin crear una cuenta. Si ingresa, sus datos y pedidos quedan guardados.",
  botonIngresar: "Ingresar",
  botonRegistrarse: "Crear cuenta",
  /** El invitado recarga o vuelve sin el token: no se muestra nada del pedido. */
  sinToken:
    "Para continuar, use el enlace «Pagar su pedido» que le enviamos por correo.",
  sinTokenTitulo: "No podemos mostrar este pedido",
  /** Confirmación por transferencia. */
  transferenciaComprobante:
    "Cuando realice la transferencia, envíenos el comprobante por WhatsApp o por correo electrónico indicando el número de su pedido.",
  correoDetalle: "Le enviamos el detalle a",
  tokenVencido:
    "Su sesión de compra venció. Para continuar, use el enlace «Pagar su pedido» que le enviamos por correo.",
} as const;

export const ERRORES_INVITADO = {
  emailInvalido: "Ingrese un correo electrónico válido.",
  emailsDistintos: "Los correos electrónicos no coinciden.",
  nombre: "Ingrese su nombre y apellido.",
  telefono: "Ingrese un teléfono válido, con código de área.",
  modo: "Indique si necesita factura A o es consumidor final.",
  verificacion: "No pudimos verificar la solicitud. Inténtelo nuevamente.",
  sinConexion: "No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.",
} as const;
