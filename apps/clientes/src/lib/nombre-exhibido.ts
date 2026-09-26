/**
 * Nombre con el que se exhibe un producto: el mismo en el catálogo, la ficha,
 * el carrito y la cotización (checkout y pedido).
 *
 * Orden: el curado en el CRM; si no, el `name` de Alegra. La descripción de
 * Alegra sólo reemplaza al `name` cuando el `name` es el código (la referencia,
 * o la referencia sin el sufijo de marca): en esta cuenta el `name` trae el
 * nombre y la descripción las características. Un texto vacío no pisa (`||` en
 * TS, `nullif` en SQL). Es la misma regla que `nombreEfectivo` del CRM.
 */
import { and, eq, sql } from "drizzle-orm";
import { crmCatalogo, crmOverlay } from "@/db/crm";
import { shopTenantId } from "./tenant";

export function nameEsCodigo(fila: { name: string; code: string | null }): boolean {
  const name = fila.name?.trim().toUpperCase();
  const code = fila.code?.trim().toUpperCase();
  return !!name && !!code && (code === name || code.startsWith(`${name}-`));
}

export function nombreExhibido(fila: {
  overlayNombre: string | null;
  description: string | null;
  name: string;
  code: string | null;
}): string {
  return (
    fila.overlayNombre?.trim() ||
    (nameEsCodigo(fila) ? fila.description?.trim() : "") ||
    fila.name
  );
}

/**
 * `nombreExhibido` en SQL, para consultas con base en la vista del CRM
 * (`crmCatalogo`) que ya traen el overlay (`joinOverlay`).
 */
export const nombreExhibidoSql = sql<string>`coalesce(
  nullif(btrim(${crmOverlay.nombre}), ''),
  CASE WHEN nullif(btrim(${crmCatalogo.name}), '') IS NOT NULL AND (
    upper(btrim(${crmCatalogo.code})) = upper(btrim(${crmCatalogo.name}))
    OR starts_with(upper(btrim(${crmCatalogo.code})), upper(btrim(${crmCatalogo.name})) || '-')
  ) THEN nullif(btrim(${crmCatalogo.description}), '') END,
  ${crmCatalogo.name}
)`;

/**
 * Join al overlay del CRM (puede no tener fila). La tabla es de todos los
 * tenants del CRM: el tenant va en el join, no en el WHERE, para no convertirlo
 * en un inner join. Función y no constante: el tenant se lee del entorno en
 * cada consulta.
 */
export const joinOverlay = () =>
  and(eq(crmOverlay.alegraId, crmCatalogo.alegraId), eq(crmOverlay.tenantId, shopTenantId()));
