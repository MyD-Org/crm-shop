/**
 * Flag de disponibilidad por sucursal. Se lee sólo en el server.
 *
 * Apagado (default): el Shop se comporta como antes: un solo stock (vista 0012 del CRM menos
 * `shop.stock_reservado`), sin ocultamiento por sucursal (`oculto_en_sucursales` se IGNORA) y la
 * reserva del pedido no vence por regla del CRM. Prendido: stock por sucursal menos
 * `shop.stock_reservado_sucursal`, retiro con demora, envío con respaldo, productos ocultos por
 * sucursal y reserva con el vencimiento de `reglas_venta`.
 *
 * Depende del flag `sucursales` (la zona del visitante y la asignación de sucursal salen de ahí):
 * con `sucursales` apagado este flag no hace nada. Orden de prendido: `sucursales` primero.
 * Falla hacia apagado.
 *
 * Vive en Vercel Flags (key `disponibilidad-sucursal`, ver src/flags.ts): se cambia sin redeploy.
 */
import { disponibilidadSucursalFlag } from "@/flags";
import { sucursalesHabilitadas } from "./sucursales-flag";

export async function disponibilidadSucursalHabilitada(): Promise<boolean> {
  try {
    if (!(await sucursalesHabilitadas())) return false;
    return await disponibilidadSucursalFlag();
  } catch (err) {
    console.error(
      "[disponibilidad-sucursal-flag] no se pudo evaluar el flag; se asume apagado:",
      err,
    );
    return false;
  }
}
