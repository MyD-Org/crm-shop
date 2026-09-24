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
 * Al stock de la fuente elegida se le resta lo que tienen apartado los pedidos
 * vivos del Shop (vista `shop.stock_reservado`, migración 0012): lo que se
 * muestra y se valida es el DISPONIBLE, `max(0, stock − reservado)`, calculado
 * al leer. El espejo nunca se toca: una re-lectura de Alegra no borra una
 * reserva, y cancelar, entregar, marcar facturado o dejar vencer un pendiente
 * la libera sin escribir nada.
 *
 * Toda consulta que use estas expresiones tiene que hacer
 * `.leftJoin(crmStock, joinStockCrm()).leftJoin(stockReservado, joinReserva())`:
 * left joins con el tenant EN el join, para que un ítem sin fila en el CRM o sin
 * reservas no desaparezca.
 *
 * SOLO servidor.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { catalogProducts, stockReservado } from "@/db/schema";
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

/**
 * Join de la reserva: la vista suma todos los tenants, el tenant va en el join.
 * Una fila por (tenant, ítem): no multiplica filas.
 */
export const joinReserva = () =>
  and(eq(stockReservado.alegraItemId, catalogProducts.alegraId), eq(stockReservado.tenantId, shopTenantId()));

/** Stock de la fuente elegida, SIN restar reservas. */
const stockFuenteSql = sql`(case when ${usarCrmSql} then ${crmStock.stock} else ${catalogProducts.stock} end)`;

/**
 * Disponible: stock de la fuente elegida menos lo reservado, nunca negativo
 * (si una factura bajó el stock por debajo de lo reservado, se muestra 0).
 * null = ítem no inventariable (siempre disponible), con o sin reservas.
 */
export const stockSql = sql<string | null>`(case when ${stockFuenteSql} is null then null else greatest(0, ${stockFuenteSql} - coalesce(${stockReservado.qty}, 0)) end)`.mapWith(
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

/** Transacción (o cliente) de drizzle: lo único que se usa es `select`. */
type Lector = Pick<ReturnType<typeof getDb>, "select">;

/**
 * Relee el disponible de `ids` DENTRO de la transacción de `crearPedido`, con la
 * misma expresión que el catálogo y la cotización (fuente más fresca − reserva).
 * Se llama después de tomar los locks por ítem: en READ COMMITTED cada sentencia
 * ve lo que commiteó el checkout que tuvo el lock antes, así que su reserva ya
 * cuenta. El pedido que se está creando todavía no tiene líneas: no se cuenta a
 * sí mismo.
 *
 * Un id que no está en el espejo no vuelve en el mapa: quien llama lo trata como
 * sin stock.
 */
export async function disponiblesEnTx(tx: Lector, ids: string[]): Promise<Map<string, number | null>> {
  if (ids.length === 0) return new Map();
  const filas = await tx
    .select({ alegraId: catalogProducts.alegraId, disponible: stockSql })
    .from(catalogProducts)
    .leftJoin(crmStock, joinStockCrm())
    .leftJoin(stockReservado, joinReserva())
    .where(inArray(catalogProducts.alegraId, ids));
  return new Map(filas.map((f) => [f.alegraId, f.disponible == null ? null : Number(f.disponible)]));
}

/**
 * Al confirmar, alguna línea pide más de lo disponible: otro checkout se llevó
 * las unidades entre la cotización y el pedido. `crearPedido` la tira para
 * deshacer la transacción; la ruta re-cotiza y responde el 409 de siempre.
 */
export class StockInsuficienteError extends Error {
  constructor(readonly ids: string[]) {
    super(`Stock insuficiente para ${ids.length} ítem(s)`);
    this.name = "StockInsuficienteError";
  }
}
