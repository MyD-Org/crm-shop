/**
 * Flag de sucursales y zonas. Se lee sólo en el server.
 *
 * Apagado (default): el Shop se comporta como antes, sin selector de zona, y el pedido queda con
 * `sucursal`, `sucursal_regla` y `sucursal_asignada_en` en NULL. Prendido: el header del catálogo
 * muestra la zona vigente (cookie `shop_zona`), y `POST /api/pedidos` asigna la sucursal con las
 * reglas que cargó el CRM y las congela en el pedido. Falla hacia apagado.
 *
 * Vive en Vercel Flags (key `sucursales`, ver src/flags.ts): se cambia sin redeploy.
 */
import { sucursalesFlag } from "@/flags";

export async function sucursalesHabilitadas(): Promise<boolean> {
  try {
    return await sucursalesFlag();
  } catch (err) {
    console.error(
      "[sucursales-flag] no se pudo evaluar el flag; se asume apagado:",
      err,
    );
    return false;
  }
}
