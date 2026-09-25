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
 * las tablas del catálogo; el de las vistas del catálogo de Alegra
 * (`catalog_products_shop` y `catalog_categories_shop`) lo conceden las
 * migraciones 0035 y 0037 de apps/admin; los de cuenta corriente (vista del espejo de
 * contactos, `tenants` por columna, condiciones, avisos y comprobantes) los
 * concede la migración 0032 de apps/admin (ver docs/una-base-esquema-shop.md,
 * "Cuenta corriente: lectura/escritura en public").
 *
 * Contrato de columnas: `crm-contrato.test.ts` compara lo declarado acá contra
 * `__fixtures__/crm-contrato.json`. Si el CRM cambia una columna, se actualizan
 * los dos en el mismo cambio (y el lado CRM verifica el fixture contra su base).
 */
import {
  PgSchema,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * `public`, CALIFICADO. Con `pgTable` drizzle escribe el nombre pelado
 * (`"catalog_overlay"`) y lo resuelve el `search_path`, que para `shop_app` es
 * `shop, public`: si el esquema `shop` tuviera una tabla homónima (como la
 * copia vieja del catálogo), la consulta leería ésa y no la del CRM. `pgSchema("public")`
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

// ---------------------------------------------------------------------------
// Cuenta corriente (change `portal-al-shop`). Dueño del DDL: apps/admin.
// Permisos: migración 0032_shop_cuenta_corriente.sql de apps/admin.
// ---------------------------------------------------------------------------

/**
 * Espejo de contactos de Alegra, visto por el Shop (`public.alegra_contacts_shop`,
 * migraciones 0031, 0032, 0034 y 0036 de apps/admin). Es una VISTA: `.existing()`
 * para que drizzle-kit nunca intente crearla. No expone `raw`, `phones_norm` ni
 * `seller_id`.
 *
 * `tipo_cuenta` es la columna generada del CRM (plazo > 0 o límite > 0 ⇒
 * `corriente`): el Shop la LEE, no la recalcula. `status` NO es el estado de
 * Alegra: es "visto en la última corrida de la sync" (`active` | `inactive`).
 */
export const crmContactos = publico
  .view("alegra_contacts_shop", {
    tenantId: text("tenant_id").notNull(),
    alegraAccount: text("alegra_account").notNull(),
    alegraId: text("alegra_id").notNull(),
    name: text("name").notNull(),
    identification: text("identification"),
    identificationNorm: text("identification_norm"),
    email: text("email"),
    emailsNorm: text("emails_norm").array().notNull(),
    types: text("types").array().notNull(),
    priceListId: text("price_list_id"),
    priceListName: text("price_list_name"),
    priceListStatus: text("price_list_status"),
    tipoCuenta: text("tipo_cuenta").$type<"corriente" | "contado">(),
    alegraStatus: text("alegra_status"),
    status: text("status").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    // 0032: lo que necesitan Condiciones y la barra de límite de crédito.
    sellerName: text("seller_name"),
    paymentTermName: text("payment_term_name"),
    paymentTermDays: integer("payment_term_days"),
    creditLimit: numeric("credit_limit", { precision: 16, scale: 2 }),
    // 0034 (change `contacto-fuente-unica`): datos de facturación, columnas
    // GENERADAS desde `raw` en el CRM. Vacío o ausente en Alegra ⇒ NULL.
    ivaCondition: text("iva_condition"),
    identificationType: text("identification_type"),
    identificationNumber: text("identification_number"),
    addressStreet: text("address_street"),
    addressCity: text("address_city"),
    addressProvince: text("address_province"),
    addressPostalCode: text("address_postal_code"),
    // 0036: teléfonos tal cual los guarda la sync (texto de Alegra, sin
    // normalizar). El checkout no vuelve a pedir un teléfono que ya está acá.
    // Requieren la 0036 aplicada en la base: sin ella, la vista no los tiene.
    phonePrimary: text("phone_primary"),
    phoneSecondary: text("phone_secondary"),
    mobile: text("mobile"),
  })
  .existing();

/**
 * Catálogo de productos del CRM (`public.catalog_products_shop`, migraciones
 * 0035 y 0037 de apps/admin). Es la ÚNICA fuente del catálogo del Shop: el CRM
 * la mantiene al día con su sync diaria y con los webhooks de Alegra (un cambio
 * de nombre, stock o precio llega en minutos). Es una VISTA de todos los
 * tenants: toda consulta que la tenga de base filtra por
 * `tenant_id = shopTenantId()` en el WHERE (`enTenantCatalogo`, ver
 * `src/lib/catalogo-fuente.ts`). `shop_app` tiene SELECT sobre la vista y nada
 * sobre la tabla (no ve `raw`).
 *
 * - `preciosAlegra` es `raw->'price'` TAL CUAL lo manda Alegra (ids numéricos,
 *   `main` incluido): se normaliza con `mapPrecios` antes de resolver una lista.
 * - `activo` = visto en la última sync del CRM y no inactivo en Alegra.
 * - `alegraLeidoAt` = cuándo se le pidió el dato a Alegra (frescura).
 * - `brand` sigue la regla del CRM (customField llamado "marca"/"brand").
 * - `ivaPorcentaje` es la SUMA de los impuestos del ítem en Alegra (regla única
 *   del CRM, `alegra_suma_impuestos`); null = sin impuestos numéricos.
 */
export const crmCatalogo = publico
  .view("catalog_products_shop", {
    tenantId: text("tenant_id").notNull(),
    alegraId: text("alegra_id").notNull(),
    stock: numeric("stock"),
    preciosAlegra: jsonb("precios_alegra").notNull(),
    activo: boolean("activo").notNull(),
    alegraLeidoAt: timestamp("alegra_leido_at", { withTimezone: true }),
    // 0037: el producto entero, para que el Shop no necesite copia propia.
    name: text("name").notNull(),
    description: text("description"),
    code: text("code"),
    brand: text("brand"),
    categoryAlegraId: text("category_alegra_id"),
    ivaPorcentaje: numeric("iva_porcentaje", { precision: 5, scale: 2 }),
  })
  .existing();

/**
 * Categorías de Alegra según el CRM (`public.catalog_categories_shop`,
 * migración 0037 de apps/admin). No confundir con `crmCategorias`, que es el
 * árbol PROPIO de la tienda (`shop_categories`). Vista de todos los tenants: el
 * join producto → categoría lleva el tenant EN el ON (`joinCategoriasAlegra`).
 * `activo` = vista en la última sync del CRM.
 */
export const crmCategoriasAlegra = publico
  .view("catalog_categories_shop", {
    tenantId: text("tenant_id").notNull(),
    alegraId: text("alegra_id").notNull(),
    name: text("name").notNull(),
    parentAlegraId: text("parent_alegra_id"),
    activo: boolean("activo").notNull(),
  })
  .existing();

/**
 * Función del CRM que deja el espejo al día después de un PUT del Shop a
 * Alegra (migración 0034 de apps/admin): `SECURITY DEFINER`, EXECUTE sólo para
 * `shop_app`. Recibe el contacto COMPLETO que devolvió Alegra y:
 *  - actualiza sólo una fila existente de (tenant, cuenta, id): nunca inserta;
 *  - sólo acepta llenar vacíos (nombre, documento, condición y domicilio no se
 *    pueden pisar ni borrar: D1 también en la base);
 *  - responde `'ok' | 'sin_fila' | 'rechazado'`.
 *
 * No entra al fixture de contrato (el test compara tablas/vistas): la firma la
 * cubre el test de integración del CRM. El jsonb se pasa como TEXTO y se castea
 * (`::text::jsonb`): postgres.js vuelve a serializar un string que va directo
 * a un parámetro `jsonb` y la función lo rechaza por no ser un objeto.
 */
export const FN_WRITE_THROUGH =
  "public.shop_contacto_write_through(text, text, text, jsonb)" as const;

/**
 * Datos públicos del tenant (`public.tenants`). El GRANT es POR COLUMNA: el
 * resto de la tabla (credenciales de Alegra, de la ai-api…) no se puede leer
 * como `shop_app`. Nunca declarar acá otra columna sin ampliar el GRANT.
 */
export const crmTenants = publico.table("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  whatsappNumber: text("whatsapp_number").notNull(),
  receiptsEmail: text("receipts_email").notNull(),
});

/**
 * Condiciones comerciales cargadas a mano en el CRM
 * (`public.client_commercial_conditions`): lo que Alegra no modela (descuentos
 * por rubro, transporte, teléfono/email del vendedor). Sólo lectura.
 */
export const crmCondiciones = publico.table("client_commercial_conditions", {
  id: uuid("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  codigocliente: text("codigocliente").notNull(),
  condicionPago: text("condicion_pago").notNull(),
  plazoDias: integer("plazo_dias").notNull(),
  listaPrecios: text("lista_precios").notNull(),
  descuentos: jsonb("descuentos").$type<{ concepto: string; porcentaje: number }[]>().notNull(),
  vendedor: jsonb("vendedor").$type<{ nombre?: string; telefono?: string; email?: string }>().notNull(),
  transporte: jsonb("transporte").$type<{ modalidad?: string; observaciones?: string }>().notNull(),
});

/**
 * Avisos de vencimiento que envía el CRM (`public.notification_log`). El Shop
 * los lee y sólo puede escribir `read_at` (GRANT por columna).
 */
export const crmAvisos = publico.table("notification_log", {
  id: uuid("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  codigocliente: text("codigocliente").notNull(),
  facturaId: text("factura_id").notNull(),
  facturaAlegraId: text("factura_alegra_id"),
  type: text("type").notNull(),
  channel: text("channel").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
});

/**
 * Comprobantes de pago informados por el cliente (`public.payment_receipts`).
 * El Shop inserta y actualiza sólo las columnas del flujo de informar pago
 * (GRANT por columna en 0032): nunca `loaded_*`, `alegra_payment_*`,
 * `declared_amount/paid_on`, `amount` ni `codigocliente` después del alta. Sin
 * DELETE. Las columnas del backoffice que el Shop no usa (quién lo cargó) no
 * se declaran.
 */
export const crmComprobantes = publico.table("payment_receipts", {
  id: uuid("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  codigocliente: text("codigocliente").notNull(),
  razonsocial: text("razonsocial").notNull(),
  cuit: text("cuit").notNull(),
  clientEmail: text("client_email"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  paidOn: date("paid_on").notNull(),
  method: text("method").notNull(),
  methodOther: text("method_other"),
  notes: text("notes"),
  status: text("status").notNull(),
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
  rejectReason: text("reject_reason"),
  declaredContentType: text("declared_content_type").notNull(),
  declaredSize: integer("declared_size").notNull(),
  fileKey: text("file_key"),
  fileMime: text("file_mime"),
  fileSize: integer("file_size"),
  fileOriginalName: text("file_original_name"),
  fileSha256: text("file_sha256"),
  convertedFrom: text("converted_from"),
  emailStatus: text("email_status").notNull(),
  emailError: text("email_error"),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  emailAttempts: integer("email_attempts").notNull(),
  emailLastAttemptAt: timestamp("email_last_attempt_at", { withTimezone: true }),
  loadedAt: timestamp("loaded_at", { withTimezone: true }),
  alegraPaymentNumber: text("alegra_payment_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
