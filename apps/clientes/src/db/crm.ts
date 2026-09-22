/**
 * Tablas del CRM que el Shop LEE directo: comparten base (el Shop vive en el
 * esquema `shop`, el CRM en `public`), así que el catálogo comercial se consulta
 * en su lugar en vez de copiarlo por HTTP.
 *
 * SÓLO LECTURA y sólo las columnas que el Shop usa. El dueño de estas tablas y
 * de sus migraciones es `apps/admin`: por eso viven fuera de `schema.ts`, que es
 * lo único que mira `drizzle.config.ts` — declararlas ahí haría que
 * `db:generate` intentara crearlas.
 *
 * Toda lectura filtra por `tenant_id = shopTenantId()`: las tablas son de todos
 * los tenants del CRM.
 *
 * Permisos: el rol de runtime del Shop (`shop_app`) necesita `SELECT` sobre
 * estas dos tablas (ver docs/una-base-esquema-shop.md).
 */
import { PgSchema, boolean, integer, jsonb, smallint, text, uuid } from "drizzle-orm/pg-core";

/**
 * `public`, CALIFICADO. Con `pgTable` drizzle escribe el nombre pelado
 * (`"catalog_overlay"`) y lo resuelve el `search_path`, que para `shop_app` es
 * `shop, public`: como el esquema `shop` tiene tablas homónimas (la copia vieja
 * del catálogo), la consulta leería ésas y no las del CRM. `pgSchema("public")`
 * está vedado por drizzle para que nadie genere migraciones sobre `public`;
 * instanciar la clase lo saltea, y acá es seguro porque este archivo no lo mira
 * drizzle-kit.
 */
const publico = new PgSchema("public");

/** Una foto del overlay tal como la guarda el CRM: la KEY en R2, no la URL. */
export interface FotoCrm {
  key: string;
  w: number;
  alt?: string;
}

/** Taxonomía propia de la tienda, hasta 3 niveles (`public.shop_categories`). */
export const crmCategorias = publico.table("shop_categories", {
  id: uuid("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  parentId: uuid("parent_id"),
  nombre: text("nombre").notNull(),
  orden: integer("orden").notNull(),
  nivel: smallint("nivel").notNull(),
  activa: boolean("activa").notNull(),
});

/**
 * Overlay comercial por producto (`public.catalog_overlay`). ESPARSO: sólo hay
 * fila para los productos que alguien tocó en el admin; sin fila, el producto
 * no está publicado.
 */
export const crmOverlay = publico.table("catalog_overlay", {
  id: uuid("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  alegraId: text("alegra_id").notNull(),
  visible: boolean("visible").notNull(),
  nombre: text("nombre"),
  categoriaId: uuid("categoria_id"),
  fotos: jsonb("fotos").$type<FotoCrm[]>().notNull(),
});
