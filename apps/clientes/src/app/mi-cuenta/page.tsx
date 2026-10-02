import { redirect } from "next/navigation";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

/**
 * Mi cuenta abre en Pedidos: no hay una vista de resumen aparte. El
 * `?tab=datos` viejo lo resuelve antes un redirect de next.config.ts.
 */
export default function MiCuentaPage() {
  redirect(RUTAS_MI_CUENTA.pedidos);
}
