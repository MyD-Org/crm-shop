/**
 * Datos del menú del usuario del header. Módulo puro: vive aparte del
 * componente para poder testearlo sin DOM (el vitest del shop corre en `node`).
 */

import {
  CAPACIDADES_DESPLIEGUE,
  RUTAS_MI_CUENTA,
  type CapacidadesDespliegue,
} from "./mi-cuenta-nav";

/** Adónde lleva "Mis pedidos". */
export const HREF_MIS_PEDIDOS = "/mi-cuenta";

/** Sección "Mis datos" de Mi cuenta: ahí vive el formulario de facturación. */
export const HREF_MIS_DATOS = RUTAS_MI_CUENTA.datos;

/** Sección de favoritos de Mi cuenta. */
export const HREF_FAVORITOS = RUTAS_MI_CUENTA.favoritos;

/**
 * "Facturación" lleva a "Facturas y saldo": desde que el portal del CRM dejó de
 * enlazarse, el Shop es la única puerta a la cuenta corriente del cliente.
 */
export const HREF_FACTURACION = RUTAS_MI_CUENTA.facturas;

/**
 * Ruta inicial de la pestaña de Seguridad dentro del panel de Clerk
 * (`__experimental_startPath` de `openUserProfile`). Es lo único que sigue
 * siendo de Clerk: contraseña, correo, verificación en dos pasos y sesiones.
 */
export const RUTA_PANEL_SEGURIDAD = "/security";

export type IdEntradaMenu = "pedidos" | "favoritos" | "facturacion" | "datos" | "seguridad" | "salir";

export interface EntradaMenu {
  id: IdEntradaMenu;
  label: string;
  tone?: "danger";
}

/**
 * Entradas del menú, en el orden de la navegación de Mi cuenta. Favoritos y
 * Facturación aparecen sólo cuando el despliegue ya publica su sección.
 * "Facturas" y nunca "Cuenta corriente": la ven también los clientes de
 * contado (y quien no vinculó, que ahí encuentra cómo hacerlo). Los
 * separadores los agrega el componente.
 */
export function entradasMenu(
  despliegue: CapacidadesDespliegue = CAPACIDADES_DESPLIEGUE,
): readonly EntradaMenu[] {
  return [
    { id: "pedidos", label: "Mis pedidos" },
    ...(despliegue.favoritos ? [{ id: "favoritos", label: "Favoritos" } as const] : []),
    ...(despliegue.facturas ? [{ id: "facturacion", label: "Facturas" } as const] : []),
    { id: "datos", label: "Mis datos" },
    { id: "seguridad", label: "Seguridad" },
    { id: "salir", label: "Cerrar sesión", tone: "danger" },
  ];
}

/** Menú del despliegue actual. */
export const ENTRADAS_MENU: readonly EntradaMenu[] = entradasMenu();

/**
 * Texto para el lector de pantalla del botón que abre el menú. El nombre
 * visible se oculta en móvil, así que el botón necesita su propia etiqueta.
 */
export function etiquetaBotonMenu(nombre: string | null): string {
  return nombre ? `Menú de la cuenta de ${nombre}` : "Menú de su cuenta";
}
