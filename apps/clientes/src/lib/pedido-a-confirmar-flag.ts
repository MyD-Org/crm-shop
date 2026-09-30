/**
 * Flag del pedido "a confirmar" (rebanada C de sucursales). Se lee sólo en el server.
 *
 * Apagado (default): el checkout es el de siempre (opciones de pago fijas o "a coordinar" según el
 * flag `pagos`), y la confirmación no promete plazo ni muestra el WhatsApp de la sucursal.
 * Prendido: el paso Pago ofrece los medios cargados en el CRM (`medios_pago_shop`) aplicables a la
 * modalidad elegida, sin cobro en ese paso; el pedido guarda el `slug` del medio; y la
 * confirmación (pantalla, mail y Mi cuenta) informa el plazo de contacto y el WhatsApp de la
 * sucursal asignada. Si la tabla de medios no existe o está vacía, se sigue con las opciones fijas.
 *
 * No depende de `sucursales`: sin sucursal asignada la confirmación usa el texto genérico.
 * Falla hacia apagado. Vive en Vercel Flags (key `pedido-a-confirmar`, ver src/flags.ts).
 */
import { pedidoAConfirmarFlag } from "@/flags";

export async function pedidoAConfirmarHabilitado(): Promise<boolean> {
  try {
    return await pedidoAConfirmarFlag();
  } catch (err) {
    console.error("[pedido-a-confirmar-flag] no se pudo evaluar el flag; se asume apagado:", err);
    return false;
  }
}
