/**
 * De dónde salen el stock, los precios y el estado de un producto.
 *
 * Una sola fuente: la vista del CRM `public.catalog_products_shop`
 * (`crmCatalogo`). La mantienen la sync diaria del CRM y los webhooks de Alegra
 * (una factura, una compra o una edición re-leen sus ítems en minutos). El Shop
 * no tiene copia propia del catálogo: ya no hay que elegir fuente por fila.
 *
 * Al stock se le resta lo que tienen apartado los pedidos vivos del Shop (vista
 * `shop.stock_reservado`, migración 0012): lo que se muestra y se valida es el
 * DISPONIBLE, `max(0, stock − reservado)`, calculado al leer. La vista del CRM
 * nunca se toca: una re-lectura de Alegra no borra una reserva, y cancelar,
 * entregar, marcar facturado o dejar vencer un pendiente la libera sin escribir
 * nada.
 *
 * Toda consulta que use `stockSql` hace `.from(crmCatalogo)` con
 * `enTenantCatalogo()` en el WHERE y `.leftJoin(stockReservado, joinReserva())`:
 * left join con el tenant EN el join, para que un ítem sin reservas no
 * desaparezca.
 *
 * SOLO servidor.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { stockReservado } from "@/db/schema";
import { crmCatalogo, crmOverlay } from "@/db/crm";
import { enTenantCatalogo } from "./catalogo-fuente";
import { joinOverlay } from "./nombre-exhibido";
import { shopTenantId } from "./tenant";

/**
 * Join de la reserva: la vista suma todos los tenants, el tenant va en el join.
 * Una fila por (tenant, ítem): no multiplica filas.
 */
export const joinReserva = () =>
  and(eq(stockReservado.alegraItemId, crmCatalogo.alegraId), eq(stockReservado.tenantId, shopTenantId()));

/**
 * Disponible: stock menos lo reservado, nunca negativo (si una factura bajó el
 * stock por debajo de lo reservado, se muestra 0). null = ítem no inventariable
 * (siempre disponible), con o sin reservas.
 */
export const stockSql = sql<string | null>`(case when ${crmCatalogo.stock} is null then null else greatest(0, ${crmCatalogo.stock} - coalesce(${stockReservado.qty}, 0)) end)`.mapWith(
  crmCatalogo.stock,
);

/**
 * Precios CRUDOS de Alegra (ids numéricos, `main` incluido): quien los lee en TS
 * los pasa por `mapPrecios`. En SQL sirven tal cual: `price` y `main`.
 */
export const preciosSql = sql<unknown>`${crmCatalogo.preciosAlegra}`.mapWith(crmCatalogo.preciosAlegra);

/**
 * ¿El producto se puede mostrar y comprar? Visto en la última sync del CRM, no inactivo en Alegra
 * Y no ocultado a mano en la tienda (`catalog_overlay.oculta_en_tienda` de SU PROPIA fila de
 * overlay, por su `alegra_id`: no la del ancla del grupo, que es la visibilidad del modelo).
 *
 * Es el único punto por el que pasan listado, conteo, facetas, destacados, búsqueda, selector de
 * variantes, carrito, favoritos, cotización y checkout, así que una variante oculta desaparece de
 * todas esas superficies a la vez. Sin fila de overlay (o con la columna en false) no cambia nada.
 * La subconsulta usa la tabla sin alias: dentro de su FROM tapa al `catalog_overlay` del join de
 * afuera y se correlaciona sólo con la vista de productos.
 */
export const activoSql = sql<boolean>`(${crmCatalogo.activo} and not exists (select 1 from ${crmOverlay} where ${crmOverlay.tenantId} = ${crmCatalogo.tenantId} and ${crmOverlay.alegraId} = ${crmCatalogo.alegraId} and ${crmOverlay.ocultaEnTienda}))`;

/** El mismo estado como texto (`active` | `inactive`), para quien espera la columna `status`. */
export const estadoSql = sql<string>`(case when ${activoSql} then 'active' else 'inactive' end)`;

/** Transacción (o cliente) de drizzle: lo único que se usa es `select`. */
type Lector = Pick<ReturnType<typeof getDb>, "select">;

/**
 * Relee el disponible de `ids` DENTRO de la transacción de `crearPedido`, con la
 * misma expresión que el catálogo y la cotización (stock del CRM − reserva).
 * Se llama después de tomar los locks por ítem: en READ COMMITTED cada sentencia
 * ve lo que commiteó el checkout que tuvo el lock antes, así que su reserva ya
 * cuenta. El pedido que se está creando todavía no tiene líneas: no se cuenta a
 * sí mismo.
 *
 * Un id que no está en la vista (de este tenant) no vuelve en el mapa: quien llama lo trata como
 * sin stock.
 */
export async function disponiblesEnTx(tx: Lector, ids: string[]): Promise<Map<string, number | null>> {
  if (ids.length === 0) return new Map();
  const filas = await tx
    .select({ alegraId: crmCatalogo.alegraId, disponible: stockSql })
    .from(crmCatalogo)
    .leftJoin(stockReservado, joinReserva())
    .where(and(enTenantCatalogo(), inArray(crmCatalogo.alegraId, ids)));
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

/**
 * Con el flag `catalogo-solo-visibles`, alguna línea es de un producto despublicado en el overlay
 * del CRM (o sin fila de overlay: fail-closed, igual que el catálogo). Un carrito viejo no lo puede
 * comprar. El `message` se muestra tal cual al cliente.
 */
export class ProductoNoDisponibleError extends Error {
  constructor(readonly ids: string[]) {
    super("Uno de los productos de su carrito ya no está disponible. Revise su carrito.");
    this.name = "ProductoNoDisponibleError";
  }
}

/**
 * Ids de `ids` que NO están visibles en el overlay (mismo criterio que el catálogo: `visible = true`).
 * Con `agrupar` (flag `variantes-selector`) la visibilidad es la del overlay del ancla del grupo: la
 * variante vive sin overlay propio, así que sin esto un carrito con una variante nunca pasaría.
 */
export async function noVisiblesEnTx(tx: Lector, ids: string[], agrupar = false): Promise<string[]> {
  if (ids.length === 0) return [];
  const filas = await tx
    .select({ alegraId: crmCatalogo.alegraId })
    .from(crmCatalogo)
    .innerJoin(crmOverlay, joinOverlay(agrupar))
    .where(and(enTenantCatalogo(), inArray(crmCatalogo.alegraId, ids), eq(crmOverlay.visible, true)));
  const visibles = new Set(filas.map((f) => f.alegraId));
  return ids.filter((id) => !visibles.has(id));
}
