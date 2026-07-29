import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Espejo local del catálogo de Alegra.
 *
 * Alegra sigue siendo el system of record: acá vive una copia de solo lectura
 * que refresca la sync diaria (src/lib/catalog-sync.ts). Existe porque Alegra
 * topea las consultas en 30 items por request y el catálogo tiene ~2800:
 * paginarlo en vivo en cada visita al catálogo es inviable.
 *
 * Regla (misma que el CRM): la cache se usa para LISTAR y BUSCAR; el precio y
 * el stock que el shop COMPROMETE (ficha de producto, checkout) se confirman en
 * vivo contra Alegra. Ver docs/arquitectura-integraciones.md.
 *
 * A diferencia del CRM, el shop es mono-tenant: no hay columna tenant_id.
 */

export const catalogCategories = pgTable(
  "catalog_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alegraId: text("alegra_id").notNull(),
    name: text("name").notNull(),
    parentAlegraId: text("parent_alegra_id"),
    // 'active' | 'inactive'. Inactive = no apareció en la última sync (baja
    // lógica: nunca borramos, para no romper referencias históricas).
    status: text("status").notNull().default("active"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cc_alegra_id").on(t.alegraId),
    index("cc_status_name").on(t.status, t.name),
  ],
);

export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alegraId: text("alegra_id").notNull(),
    /** `reference` en Alegra — el SKU que muestra el shop. Puede faltar. */
    code: text("code"),
    name: text("name").notNull(),
    description: text("description"),
    categoryAlegraId: text("category_alegra_id"),
    /**
     * Marca. Alegra no tiene campo nativo: sale de un customField del ítem. Si
     * viene vacío, la capa de lectura cae al nombre de la categoría.
     */
    brand: text("brand"),
    /** Todas las listas de precio del ítem: [{ idPriceList, name, price, main }]. */
    prices: jsonb("prices").notNull().default([]),
    /** Snapshot de inventario. null = ítem no inventariable (siempre disponible). */
    stock: numeric("stock"),
    status: text("status").notNull().default("active"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cp_alegra_id").on(t.alegraId),
    index("cp_code").on(t.code),
    index("cp_category").on(t.categoryAlegraId),
    index("cp_status_name").on(t.status, t.name),
  ],
);

/** Bitácora de cada corrida de sync: observabilidad y "última sincronización". */
export const catalogSyncLog = pgTable(
  "catalog_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trigger: text("trigger").notNull(), // 'cron' | 'manual'
    status: text("status").notNull().default("running"), // 'running' | 'ok' | 'error'
    itemsSynced: integer("items_synced").notNull().default(0),
    categoriesSynced: integer("categories_synced").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("csl_started").on(t.startedAt)],
);
