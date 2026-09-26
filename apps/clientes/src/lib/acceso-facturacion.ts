/**
 * ¿La identidad actual tiene acceso al grupo Facturación de Mi cuenta (Facturas
 * y saldo, Pagos, Presupuestos, Condiciones, Avisos)? SOLO servidor.
 *
 * Decisión de producto: Facturación es sólo para clientes vinculados que son
 * CUENTA CORRIENTE según el espejo del CRM (`tipoCuentaEspejo`). Sin vínculo o
 * de contado, la sección no existe: las páginas responden 404, las API también
 * (ver `requerirCuentaCorriente` en cuenta-corriente/guard.ts) y ni el menú de
 * Mi cuenta ni el del header la ofrecen. El vínculo sigue valiendo para la lista
 * de precios: esto no lo toca.
 *
 * Una consulta a la base y ninguna a Alegra. Sin fila en el espejo o con la
 * lectura caída ⇒ sin acceso (fail-closed). Envuelta en `cache()`: layout,
 * página y header comparten una sola lectura por request; fuera de un render
 * (route handlers) se comporta como la función sola.
 */
import { cache } from "react";
import { identidadActual } from "./auth";
import { tipoCuentaEspejo } from "./contactos-espejo";

export const accesoFacturacion = cache(async function accesoFacturacion(): Promise<boolean> {
  const { cliente } = await identidadActual();
  const codigo = cliente?.codigocliente;
  if (!codigo) return false;
  try {
    return (await tipoCuentaEspejo(codigo)) === "corriente";
  } catch (err) {
    // Sólo el motivo técnico: nunca datos del contacto.
    console.error(`acceso-facturacion: espejo caído (${err instanceof Error ? err.name : "desconocido"})`);
    return false;
  }
});
