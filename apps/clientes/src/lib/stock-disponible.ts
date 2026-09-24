/**
 * De dónde salen el stock, los precios y el estado de un producto.
 *
 * Hay dos espejos de Alegra que dicen lo mismo con distinta frescura:
 * - `shop.catalog_products`: lo llena la sync diaria del Shop.
 * - `public.catalog_products_shop` (vista del CRM, `crmStock`): lo mantiene la
 *   sync diaria del CRM y, además, los webhooks de stock de Alegra (una factura
 *   o una compra re-leen sus ítems en minutos).
 *
 * Regla, POR FILA: gana el dato que se le pidió a Alegra más tarde. Si el CRM
 * tiene `alegra_leido_at` posterior al `synced_at` del Shop, stock, precios y
 * estado salen del CRM; si no (o si el CRM no tiene la fila), del espejo del
 * Shop. Las dos son lecturas de la misma verdad, así que elegir la más reciente
 * nunca empeora el dato. Nombre, descripción, marca, categoría e IVA siguen
 * saliendo del espejo del Shop (el CRM calcula el IVA con otra regla).
 *
 * Toda consulta que use estas expresiones tiene que hacer
 * `.leftJoin(crmStock, joinStockCrm())`: left join con el tenant EN el join,
 * para que un ítem sin fila en el CRM no desaparezca.
 *
 * SOLO servidor.
 */

import { and, eq, sql } from "drizzle-orm";
import { catalogProducts } from "@/db/schema";
import { crmStock } from "@/db/crm";
import { shopTenantId } from "./tenant";

/**
 * Join del espejo del Shop con la vista del CRM. La vista es de todos los
 * tenants: el tenant va en el join. Función y no constante: el tenant se lee
 * del entorno en cada consulta.
 */
export const joinStockCrm = () =>
  and(eq(crmStock.alegraId, catalogProducts.alegraId), eq(crmStock.tenantId, shopTenantId()));

/**
 * ¿La fila del CRM es más fresca que la del Shop? Sin fila en el CRM (left
 * join) o sin `alegra_leido_at` (nunca pasó por una sync ni un webhook desde
 * que existe la columna) es null → false.
 */
export const usarCrmSql = sql<boolean>`(${crmStock.alegraLeidoAt} is not null and ${crmStock.alegraLeidoAt} > ${catalogProducts.syncedAt})`;

/** Stock de la fuente elegida. null = ítem no inventariable (siempre disponible). */
export const stockSql = sql<string | null>`(case when ${usarCrmSql} then ${crmStock.stock} else ${catalogProducts.stock} end)`.mapWith(
  catalogProducts.stock,
);

/**
 * Precios de la fuente elegida. Los del CRM llegan CRUDOS de Alegra (ids
 * numéricos): quien los lee en TS los pasa por `mapPrecios` (idempotente sobre
 * los del Shop). En SQL las dos formas sirven igual: `price` y `main` se llaman
 * igual en ambas.
 */
export const preciosSql = sql<unknown>`(case when ${usarCrmSql} then ${crmStock.preciosAlegra} else ${catalogProducts.prices} end)`.mapWith(
  catalogProducts.prices,
);

/** ¿El producto está activo según la fuente elegida? */
export const activoSql = sql<boolean>`(case when ${usarCrmSql} then ${crmStock.activo} else ${catalogProducts.status} = 'active' end)`;

/** El mismo estado como texto (`active` | `inactive`), para quien espera la columna `status`. */
export const estadoSql = sql<string>`(case when ${activoSql} then 'active' else 'inactive' end)`;
