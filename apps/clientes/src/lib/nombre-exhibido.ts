/**
 * Nombre con el que se exhibe un producto: el mismo en el catálogo, la ficha,
 * el carrito y la cotización (checkout y pedido).
 *
 * Orden: el curado en el CRM; si no, la descripción de Alegra (en esta cuenta
 * el nombre comercial vive ahí); si no, `name`, que en esta cuenta es el
 * código. Un texto vacío no pisa (`||` en TS, `nullif` en SQL).
 */
import { and, eq, sql } from "drizzle-orm";
import { catalogProducts } from "@/db/schema";
import { crmOverlay } from "@/db/crm";
import { shopTenantId } from "./tenant";

export function nombreExhibido(fila: {
  overlayNombre: string | null;
  description: string | null;
  name: string;
}): string {
  return fila.overlayNombre || fila.description || fila.name;
}

/** `nombreExhibido` en SQL, para consultas que ya traen el overlay (`joinOverlay`). */
export const nombreExhibidoSql = sql<string>`coalesce(nullif(${crmOverlay.nombre}, ''), nullif(${catalogProducts.description}, ''), ${catalogProducts.name})`;

/**
 * Join al overlay del CRM (puede no tener fila). La tabla es de todos los
 * tenants del CRM: el tenant va en el join, no en el WHERE, para no convertirlo
 * en un inner join. Función y no constante: el tenant se lee del entorno en
 * cada consulta.
 */
export const joinOverlay = () =>
  and(eq(crmOverlay.alegraId, catalogProducts.alegraId), eq(crmOverlay.tenantId, shopTenantId()));
