/**
 * Pie del resumen del checkout cuando el medio elegido es Transferencia: coherente con lo que se
 * muestra arriba (los datos de la cuenta, o el mensaje neutro si no hay cuenta aplicable).
 */
export const PIE_TRANSFERENCIA_CON_CUENTA =
  "No se le cobra nada ahora. Transfiera a la cuenta indicada y luego informe el pago desde Mis pedidos.";

export const PIE_TRANSFERENCIA_SIN_CUENTA =
  "No se le cobra nada ahora. Le enviaremos los datos para transferir.";

/** `cuentaResuelta`: hay una cuenta para mostrar (no null ni todavía sin cotización). */
export function pieTransferencia(cuentaResuelta: boolean): string {
  return cuentaResuelta ? PIE_TRANSFERENCIA_CON_CUENTA : PIE_TRANSFERENCIA_SIN_CUENTA;
}
