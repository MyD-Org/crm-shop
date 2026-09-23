import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  numeric,
  date,
  smallint,
  index,
  uniqueIndex,
  primaryKey,
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import type { WeeklySchedule, ScheduleException } from "@/lib/schedule"

const bytea = customType<{ data: Buffer }>({
  dataType() { return "bytea" },
})

// Config por tenant — reemplaza las variables de entorno {PREFIX}_*
export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(), // ej. "central-led"
  name: text("name").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  logoPath: text("logo_path").notNull(),
  // Credenciales Alegra — ERP del portal (clientes, facturas, pagos, catálogo, cotizaciones).
  // Auth Basic email:token. alegraMock=true usa fixtures locales hasta tener el token real.
  alegraEmail: text("alegra_email").notNull().default(""),
  alegraToken: text("alegra_token").notNull().default(""),
  alegraMock: boolean("alegra_mock").notNull().default(false),
  whatsappNumber: text("whatsapp_number").notNull().default(""),
  resendFrom: text("resend_from").notNull(),
  // Mail de la empresa donde el portal avisa los comprobantes de pago informados por los
  // clientes. Vacío = la feature queda sin destino (el mail queda "skipped"). Se edita desde
  // Configuración del backoffice; el valor real vive en la DB, nunca en el repo.
  receiptsEmail: text("receipts_email").notNull().default(""),
  // Hosts COMPLETOS donde vive este tenant, coma-separados (ej. "crm.cliente.example").
  // Solo hace falta para dominios propios: el caso normal es el subdominio de la plataforma
  // ("avantec.plataforma.example"), que resuelve por el primer label = este `id` sin configurar nada.
  // Vivía en la env var `{PREFIX}_DOMAINS`; está acá para que dar de alta una empresa sea un
  // INSERT y no un redeploy. Ver src/lib/tenants.ts.
  domains: text("domains").notNull().default(""),
  // Datos legales para las páginas públicas de /legal (privacidad, términos, eliminación
  // de datos). Vacío = el dato no se cargó y la página lo muestra como "[pendiente: ...]".
  legalName: text("legal_name").notNull().default(""),
  legalTaxId: text("legal_tax_id").notNull().default(""),
  legalAddress: text("legal_address").notNull().default(""),
  legalEmail: text("legal_email").notNull().default(""),
  // Copiloto del operador en el inbox (ADR 0007). false = ni siquiera se ofrece el botón.
  // No alcanza con que la ai-api responda "no configurado": sin esto el operador ve un
  // "Asistente IA" que al tocarlo da error, que es peor que no tenerlo. Avantec todavía
  // no tiene copiloto (tenants.settings.assistAgentId vacío en la ai-api).
  copilotEnabled: boolean("copilot_enabled").notNull().default(true),
  aiApiUrl: text("ai_api_url").notNull().default(""),
  aiApiKey: text("ai_api_key").notNull().default(""),
  aiAgentId: text("ai_agent_id").notNull().default(""),
  // UUID del tenant en la ai-api (para auth de inbox/staff)
  aiTenantId: text("ai_tenant_id").notNull().default(""),
  // Horario de atención canónico: franjas por día en formato { monday: [{open,close}, ...],
  // ..., sunday: [] }. Un día sin franjas = cerrado. Lo consulta el ai-api
  // (GET /api/internal/business-hours) para saber si está abierto y a qué hora. Ver src/lib/schedule.ts.
  schedule: jsonb("schedule").$type<WeeklySchedule>().notNull().default(sql`'{}'::jsonb`),
  // Excepciones al horario semanal: feriados/vacaciones (cerrado) u horario especial en una
  // fecha puntual. El ai-api las recibe renderizadas como texto en el campo `notes` de la
  // respuesta del endpoint interno (ver exceptionsToNotes en src/lib/schedule.ts).
  scheduleExceptions: jsonb("schedule_exceptions").$type<ScheduleException[]>().notNull().default(sql`'[]'::jsonb`),
  // Condiciones de pago mostradas por el agente. Ej: [{ method: "Transferencia", discount: "5%" }]
  paymentConditions: jsonb("payment_conditions").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

// Operadores del backoffice — empleados que usan la sección /admin
export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    // 'operator': puede usar el inbox y responder mensajes
    // 'superadmin': todo lo anterior + gestión de usuarios
    role: text("role").notNull().default("operator"),
    // Departamentos del operador (multi): un operador puede atender varias áreas (ej.
    // ['ventas', 'asesoramiento-tecnico']). Slugs, mismo formato que la tabla departments.
    // Se usa para el routing automático: matchea si el depto del handoff está incluido.
    departments: text("departments").array().notNull().default(sql`'{}'::text[]`),
    // Presencia para asignación de handoff: 'available' = el operador está atendiendo y
    // puede recibir conversaciones; 'away' = no se le asignan. Distinto de "cuenta activa"
    // (passwordHash): existir ≠ estar disponible ahora. Default 'away'. Ver ADR 0006.
    availability: text("availability").notNull().default("away"),
    availabilityChangedAt: timestamp("availability_changed_at", { withTimezone: true }),
    // null mientras el usuario no haya aceptado la invitación y seteado contraseña
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("admin_users_email").on(t.email)],
)

// Catálogo de departamentos por tenant — se usa como fuente única para:
// (a) el select del formulario de usuarios en el backoffice, y
// (b) el catálogo de derivación que ai-api inyecta en el agente vía /api/internal/departments.
// Los valores guardados en admin_users.departments (array) y en conversation_assignments.department
// referencian `key` (slug estable). `label` es el nombre visible y se puede renombrar
// sin migrar datos. La lista es editable por tenant (no todos tienen "Cuentas Corrientes").
export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("departments_tenant_key").on(t.tenantId, t.key)],
)

// Tokens para recuperar contraseña e invitaciones (mismo flujo):
// se genera un token aleatorio, se guarda el hash SHA-256, se envía el token plano por email.
export const adminPasswordTokens = pgTable(
  "admin_password_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    type: text("type").notNull(), // 'reset' | 'invite'
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("apt_token_hash").on(t.tokenHash)],
)

// Condiciones comerciales por cliente dentro de un tenant.
// Flexxus no las almacena, por eso viven en nuestra DB.
export const clientCommercialConditions = pgTable(
  "client_commercial_conditions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    codigocliente: text("codigocliente").notNull(),
    condicionPago: text("condicion_pago").notNull(),
    plazoDias: integer("plazo_dias").notNull().default(30),
    listaPrecios: text("lista_precios").notNull().default(""),
    descuentos: jsonb("descuentos").notNull().default([]), // { concepto, porcentaje }[]
    vendedor: jsonb("vendedor").notNull().default({}), // { nombre, telefono, email }
    transporte: jsonb("transporte").notNull().default({}), // { modalidad, observaciones }
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ccc_tenant_cliente").on(t.tenantId, t.codigocliente)],
)

// Listas de precios cargadas desde Excel (temporal hasta integrar Alegra)
// Cada lista tiene N columnas de precio (ej: "Público", "Distribuidor", "Especial")
// configuradas en priceColumns: { key: "lista1", label: "Precio público" }[]
export const priceLists = pgTable("price_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(), // ej: "Cables de acometida"
  category: text("category").notNull(), // ej: "cables-acometida"
  // [{ key: "lista1", label: "Precio público" }, ...]
  priceColumns: jsonb("price_columns").notNull().default([]),
  fileData: bytea("file_data"),
  fileName: text("file_name"),
  active: boolean("active").notNull().default(true),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

// Productos parseados del Excel de lista de precios
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceListId: uuid("price_list_id").notNull().references(() => priceLists.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    code: text("code").notNull(),
    description: text("description").notNull(),
    // { lista1: "14341.17", lista2: "12487.55", lista3: "0.00" }
    prices: jsonb("prices").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ci_tenant_code").on(t.tenantId, t.code),
    index("ci_price_list").on(t.priceListId),
  ],
)

// ── Catálogo cacheado desde Alegra (híbrido: cache local para navegar/buscar; el
// precio/stock exacto se confirma en vivo en el momento decisivo). Ver ADR catálogo Alegra. ──

// Categorías de ítems de Alegra (espejo local). Refrescadas por la sync.
export const catalogCategories = pgTable(
  "catalog_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    alegraId: text("alegra_id").notNull(),
    name: text("name").notNull(),
    parentAlegraId: text("parent_alegra_id"), // null = categoría raíz
    status: text("status").notNull().default("active"), // 'active' | 'inactive' (stale)
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cat_tenant_alegra").on(t.tenantId, t.alegraId)],
)

// Productos de Alegra (espejo local). El precio/stock acá es un SNAPSHOT de la última sync,
// para mostrar y buscar; para el número exacto se confirma en vivo (getItemsLive). Ver ADR.
export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    alegraId: text("alegra_id").notNull(),
    code: text("code"), // = reference de Alegra (puede faltar en algunos ítems)
    name: text("name").notNull(),
    description: text("description"),
    categoryAlegraId: text("category_alegra_id"),
    // Todas las listas de precio del ítem: [{ idPriceList, name, price }] (diseño flexible)
    prices: jsonb("prices").notNull().default([]),
    stock: numeric("stock"), // snapshot de inventario
    // OJO: `status` NO es el estado de Alegra, es "visto en la última corrida del sync":
    // lo que no aparece se marca 'inactive' (baja lógica). El estado real de Alegra vive en
    // `alegraStatus`. Eran lo mismo y se pisaban; por eso ahora son dos columnas.
    status: text("status").notNull().default("active"), // 'active' | 'inactive' (stale/baja)
    /** Estado que Alegra le pone al ítem ('active' | 'inactive'). null = todavía no sincronizado. */
    alegraStatus: text("alegra_status"),
    /** No es nativa de Alegra: sale de customFields. La vidriera filtra por acá. */
    brand: text("brand"),
    /** Para el precio final con IVA. El espejo del Shop ya lo tiene; éste lo necesita para dárselo. */
    ivaPorcentaje: numeric("iva_porcentaje", { precision: 5, scale: 2 }),
    /** El ítem COMPLETO como lo devuelve Alegra. Nada se descarta. ~2,5 KB por ítem. */
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    images: jsonb("images").notNull().default([]),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cp_tenant_alegra").on(t.tenantId, t.alegraId),
    index("cp_tenant_code").on(t.tenantId, t.code),
    index("cp_tenant_category").on(t.tenantId, t.categoryAlegraId),
  ],
)

// Bitácora de cada corrida de sync (observabilidad + "última sincronización" en el admin).
export const catalogSyncLog = pgTable(
  "catalog_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    trigger: text("trigger").notNull(), // 'cron' | 'manual'
    status: text("status").notNull().default("running"), // 'running' | 'ok' | 'error'
    itemsSynced: integer("items_synced").notNull().default(0),
    categoriesSynced: integer("categories_synced").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("csl_tenant_started").on(t.tenantId, t.startedAt)],
)

// ── Espejo de contactos de Alegra (change `espejo-contactos-alegra`) ──────────────────────
//
// Copia del padrón de contactos de cada cuenta de Alegra, poblada por una sync completa y
// pausada (lib/alegra-contacts-sync.ts). Sirve para no bajar el padrón en vivo: antes buscar
// por teléfono o listar clientes costaba ~200 requests contra una cuota compartida.
//
// OJO: el Shop NO lee esta tabla sino la vista `public.alegra_contacts_shop` (migración 0031,
// vive solo en SQL). Si cambia o se borra una columna expuesta en esa vista, hay que recrear
// la vista EN LA MISMA MIGRACIÓN.
export const alegraContacts = pgTable(
  "alegra_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    /** Cuenta de Alegra dentro del tenant. Hoy siempre 'principal' (una cuenta por tenant). */
    alegraAccount: text("alegra_account").notNull().default("principal"),
    alegraId: text("alegra_id").notNull(),
    name: text("name").notNull(),
    /** Crudo (string, u objeto {number} ya aplanado). */
    identification: text("identification"),
    /** Solo dígitos; null si queda vacío. */
    identificationNorm: text("identification_norm"),
    /** Crudo si es string; objeto/null → null (queda en raw). */
    email: text("email"),
    /** lower/trim, partido por [,; ]+: un contacto puede traer varias casillas. */
    emailsNorm: text("emails_norm").array().notNull().default(sql`'{}'::text[]`),
    phonePrimary: text("phone_primary"),
    phoneSecondary: text("phone_secondary"),
    mobile: text("mobile"),
    /** normalizePhone() de los tres teléfonos, sin vacíos ni repetidos. */
    phonesNorm: text("phones_norm").array().notNull().default(sql`'{}'::text[]`),
    /** raw.type de Alegra ('client' / 'provider'). */
    types: text("types").array().notNull().default(sql`'{}'::text[]`),
    priceListId: text("price_list_id"),
    priceListName: text("price_list_name"),
    priceListStatus: text("price_list_status"),
    sellerId: text("seller_id"),
    sellerName: text("seller_name"),
    paymentTermId: text("payment_term_id"),
    paymentTermName: text("payment_term_name"),
    paymentTermDays: integer("payment_term_days"),
    creditLimit: numeric("credit_limit", { precision: 16, scale: 2 }),
    /**
     * Regla canónica de cuenta corriente, en el dato: todo lector (CRM y Shop) lee esta
     * columna en vez de recalcularla. Casos cubiertos en
     * test/integration/alegra-contacts-schema.integration.test.ts.
     */
    tipoCuenta: text("tipo_cuenta").generatedAlwaysAs(
      sql`CASE WHEN coalesce("payment_term_days",0) > 0 OR coalesce("credit_limit",0) > 0 THEN 'corriente' ELSE 'contado' END`,
    ),
    /** Estado real del contacto en Alegra. */
    alegraStatus: text("alegra_status"),
    /** NO es el estado de Alegra: "visto en la última corrida OK" ('active' | 'inactive'). */
    status: text("status").notNull().default("active"),
    /** Último que escribió la fila: 'sync' | 'fallback' | 'write_through'. */
    origen: text("origen").notNull().default("sync"),
    /** El contacto COMPLETO como lo devuelve Alegra. No lo ve el Shop (fuera de la vista). */
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ac_tenant_cuenta_alegra").on(t.tenantId, t.alegraAccount, t.alegraId),
    index("ac_tenant_ident").on(t.tenantId, t.identificationNorm).where(sql`"identification_norm" IS NOT NULL`),
    index("ac_emails_gin").using("gin", t.emailsNorm),
    index("ac_phones_gin").using("gin", t.phonesNorm),
  ],
)

// Bitácora de cada corrida de la sync de contactos. `requests` mide el presupuesto de cuota
// que se llevó cada corrida.
export const alegraContactsSyncLog = pgTable(
  "alegra_contacts_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    alegraAccount: text("alegra_account").notNull().default("principal"),
    trigger: text("trigger").notNull(), // 'cron' | 'manual'
    status: text("status").notNull().default("running"), // 'running' | 'ok' | 'error' | 'skipped'
    contactsSynced: integer("contacts_synced").notNull().default(0),
    markedInactive: integer("marked_inactive").notNull().default(0),
    requests: integer("requests").notNull().default(0),
    /** Motivo técnico, NUNCA datos de contactos (nombres, emails, documentos). */
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("acsl_tenant_started").on(t.tenantId, t.startedAt)],
)

// ── Catálogo comercial del Shop, administrado desde el CRM (change `catalogo-shop`) ────────
//
// Alegra manda sobre identidad (alegra_id), stock y precio; todo lo demás se edita acá. Vive
// en tablas aparte porque alegra-sync pisa TODAS las columnas de catalog_products.

// Taxonomía propia de la tienda, hasta 3 niveles. El `nivel` está denormalizado (CHECK en la
// migración) y la app garantiza nivel = padre.nivel + 1.
export const shopCategories = pgTable(
  "shop_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    // ON DELETE RESTRICT: borrar una categoría con hijas es un 409, no una cascada.
    parentId: uuid("parent_id").references((): AnyPgColumn => shopCategories.id, {
      onDelete: "restrict",
    }),
    nombre: text("nombre").notNull(),
    slug: text("slug").notNull(),
    orden: integer("orden").notNull().default(0),
    nivel: smallint("nivel").notNull().default(1),
    activa: boolean("activa").notNull().default(true),
    // Foto de la categoría, para las tarjetas de la home y del menú de la tienda. Igual que en
    // `catalog_overlay.fotos`, se guarda la KEY del objeto en R2 y la url se compone al servir.
    imagenKey: text("imagen_key"),
    imagenAlt: text("imagen_alt"),
    // Categoría de Alegra de la que salió al importar, o null si se creó a mano. Evita duplicarla
    // si la importación se corre dos veces.
    origenAlegraId: text("origen_alegra_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Dos parciales y no un UNIQUE compuesto: en Postgres NULL <> NULL, así que un UNIQUE
    // normal no impediría dos raíces con el mismo slug.
    uniqueIndex("shop_categories_slug_raiz_uniq")
      .on(t.tenantId, t.slug)
      .where(sql`${t.parentId} is null`),
    uniqueIndex("shop_categories_slug_hijo_uniq")
      .on(t.tenantId, t.parentId, t.slug)
      .where(sql`${t.parentId} is not null`),
    index("shop_categories_tenant_parent_orden_idx").on(t.tenantId, t.parentId, t.orden),
  ],
)

/**
 * Una variante de foto del overlay. Las URLs son absolutas, públicas e inmutables: la misma
 * foto nunca cambia de URL si no se la modificó (reemplazarla es una key nueva).
 */
// Se guarda la KEY del objeto en R2, NO la URL: la base pública de hoy es un `pub-*.r2.dev`
// temporal, y mudarla a un dominio propio tiene que ser un cambio de env, no una migración de
// datos. La URL se compone al leer, en `urlPublicaFoto()`.
export interface FotoOverlay {
  key: string
  w: number
  alt?: string
}

// Overlay comercial, ESPARSO: sólo hay fila para los productos que alguien tocó. La ausencia
// de fila equivale a todos los defaults (visible=false, sin nombre, sin categoría, sin fotos).
export const catalogOverlay = pgTable(
  "catalog_overlay",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    // Sin FK a catalog_products: el overlay puede preceder al espejo.
    alegraId: text("alegra_id").notNull(),
    visible: boolean("visible").notNull().default(false),
    nombre: text("nombre"),
    descripcion: text("descripcion"),
    categoriaId: uuid("categoria_id").references(() => shopCategories.id, { onDelete: "set null" }),
    orden: integer("orden"), // null = sin destacar (NULLS LAST en la vidriera)
    fotos: jsonb("fotos").$type<FotoOverlay[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Insumo del delta hacia el Shop: lo setea el repo con now() de Postgres en CADA escritura.
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [
    uniqueIndex("catalog_overlay_tenant_alegra_uniq").on(t.tenantId, t.alegraId),
    // El orden de columnas es exactamente el del ORDER BY del cursor keyset.
    index("catalog_overlay_tenant_updated_idx").on(t.tenantId, t.updatedAt, t.alegraId),
    index("catalog_overlay_tenant_categoria_idx").on(t.tenantId, t.categoriaId),
    // "Sin foto" es el filtro central del flujo de trabajo, no un extra.
    index("catalog_overlay_sin_foto_idx")
      .on(t.tenantId)
      .where(sql`jsonb_array_length(${t.fotos}) = 0`),
  ],
)

// Tags administrables: entidad propia, planos (sin jerarquía ni orden). El uuid es la
// referencia estable ⇒ renombrar no toca ninguna fila de producto.
export const shopTags = pgTable(
  "shop_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    nombre: text("nombre").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("shop_tags_slug_uniq").on(t.tenantId, t.slug)],
)

// Relación N↔N. Toda escritura acá tiene que bumpear catalog_overlay.updated_at en la misma
// transacción: los tags de un producto viven en OTRA tabla y el delta no se entera solo.
export const catalogOverlayTags = pgTable(
  "catalog_overlay_tags",
  {
    overlayId: uuid("overlay_id")
      .notNull()
      .references(() => catalogOverlay.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => shopTags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.overlayId, t.tagId] }),
    index("cot_tag_idx").on(t.tagId),
  ],
)

// Frescura del aviso al Shop. El CRM registra SU último aviso entregado, no la sync del Shop.
export const shopSyncPing = pgTable("shop_sync_ping", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  ultimoOkAt: timestamp("ultimo_ok_at", { withTimezone: true }),
  ultimoIntentoAt: timestamp("ultimo_intento_at", { withTimezone: true }),
})

// Reglas de notificación por tenant (editables por SQL hasta que exista el panel)
export const notificationRules = pgTable("notification_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id)
    .unique(),
  daysBefore: jsonb("days_before").notNull().default([3, 1]), // días antes del vencimiento
  daysAfter: jsonb("days_after").notNull().default([1, 7, 15]), // días de mora
  channels: jsonb("channels").notNull().default(["email"]), // 'email' | 'whatsapp'
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

// Historial de notificaciones enviadas — el unique index hace la deduplicación
export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    codigocliente: text("codigocliente").notNull(),
    facturaId: text("factura_id").notNull(),
    // Id de la factura en Alegra. `factura_id` es el número legible (el que ve el cliente),
    // que no sirve para abrirla: Alegra no busca por número. Sin este id, el "Ver factura"
    // de una notificación solo encontraba la factura si estaba entre las cargadas.
    // Nullable: las notificaciones anteriores a esta columna no lo tienen.
    facturaAlegraId: text("factura_alegra_id"),
    type: text("type").notNull(), // ej. 'before_due_3' | 'after_due_7'
    channel: text("channel").notNull(), // 'email' | 'whatsapp'
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull(), // 'sent' | 'failed'
    error: text("error"),
    readAt: timestamp("read_at", { withTimezone: true }), // null = no leída
  },
  (t) => [
    index("nl_tenant_cliente_sent").on(t.tenantId, t.codigocliente, t.sentAt),
    uniqueIndex("nl_dedup").on(t.tenantId, t.codigocliente, t.facturaId, t.type, t.channel),
  ],
)

// Bitácora del copiloto: cada vez que el operador manda un mensaje que venía del "Copiar" del
// copiloto (insert-en-draft), guardamos si lo mandó tal cual o lo editó. Es la métrica que
// dispara el switch copilot → bot-first en ventas (criterio: ~80%+ as-is durante ~2 semanas).
// Ver docs/superpowers/plans/2026-07-16-copiar-a-draft.md.
export const copilotDraftEvents = pgTable(
  "copilot_draft_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    conversationId: text("conversation_id").notNull(),
    operatorId: uuid("operator_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
    // 'as-is': el operador mandó exactamente lo que el copiloto sugirió.
    // 'edited': el operador tocó el texto antes de mandar.
    outcome: text("outcome").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cde_tenant_created").on(t.tenantId, t.createdAt)],
)

// Asignación conversación → operador, DUEÑA en el CRM (no en ai-api). Ver ADR 0006.
// El bot de ai-api solo etiqueta el departamento y deriva a humano sin dueño; el CRM
// decide y persiste acá qué operador atiende cada conversación, para que no se mezclen.
// El unique(tenant, conversation) garantiza un único operador por conversación.
export const conversationAssignments = pgTable(
  "conversation_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    // conversationId es el UUID opaco de la conversación en ai-api.
    conversationId: text("conversation_id").notNull(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    // Snapshot informativo del depto al que se ruteó el handoff (viene de ai-api).
    department: text("department"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ca_tenant_conversation").on(t.tenantId, t.conversationId),
    index("ca_tenant_operator").on(t.tenantId, t.operatorId),
  ],
)

// Suscripciones Web Push de los operadores (una por browser/dispositivo). El CRM es dueño de
// las suscripciones porque los operadores son usuarios del CRM; ai-api solo dispara eventos.
// El endpoint es globalmente único (lo emite el push service del navegador), así que sirve de
// clave de deduplicación: un mismo browser re-suscribiéndose hace upsert de sus claves.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    // Datos de la PushSubscription del navegador (endpoint + claves ECDH).
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("ps_endpoint").on(t.endpoint),
    index("ps_tenant_operator").on(t.tenantId, t.operatorId),
  ],
)

// Comprobantes de pago informados por el cliente desde el portal (botón "Informar pago").
// El ARCHIVO no vive acá: está en R2 (bucket del portal). Esta tabla guarda los metadatos,
// la máquina de estados (uploading → processing → pending → loaded; rejected = interno,
// nunca visible) y el resultado del mail a la empresa. Ver migración 0023 y el design de
// comprobantes de pago. Los CHECKs viven solo en el SQL (drizzle no los necesita para leer).
export const paymentReceipts = pgTable(
  "payment_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    // Id de contacto en Alegra, de la SESIÓN del portal (nunca del body).
    codigocliente: text("codigocliente").notNull(),
    // Snapshot al informar: el backoffice no le pega a Alegra para listar.
    razonsocial: text("razonsocial").notNull(),
    cuit: text("cuit").notNull().default(""),
    clientEmail: text("client_email"),
    // amount llega como string decimal ("12345.67") y se formatea en la UI.
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("ARS"),
    paidOn: date("paid_on").notNull(),
    // 'transferencia' | 'cheque' | 'efectivo' | 'otro' (el CHECK está en la migración).
    method: text("method").notNull(),
    methodOther: text("method_other"),
    notes: text("notes"),
    // 'uploading' | 'processing' | 'pending' | 'loaded' | 'rejected' (CHECK en la migración).
    status: text("status").notNull().default("uploading"),
    // Lease del processing: el confirm lo toma con UPDATE condicional; NULL = libre.
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    // Lo que el cliente DECLARÓ en el init (firma de la URL PUT). El confirm lo contrasta con R2.
    declaredContentType: text("declared_content_type").notNull(),
    declaredSize: integer("declared_size").notNull(),
    // Lo VERIFICADO en el confirm. fileMime es siempre el sniffeado/convertido, nunca el declarado.
    fileKey: text("file_key"),
    fileMime: text("file_mime"),
    fileSize: integer("file_size"),
    fileOriginalName: text("file_original_name"),
    fileSha256: text("file_sha256"),
    convertedFrom: text("converted_from"),
    // 'pending' | 'sent' | 'failed' | 'skipped' (CHECK en la migración).
    emailStatus: text("email_status").notNull().default("pending"),
    emailError: text("email_error"),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    emailAttempts: integer("email_attempts").notNull().default(0),
    emailLastAttemptAt: timestamp("email_last_attempt_at", { withTimezone: true }),
    loadedAt: timestamp("loaded_at", { withTimezone: true }),
    // Sin FK de tenant: la escritura siempre usa el user.id del guard, que ya es del mismo tenant.
    loadedBy: uuid("loaded_by").references(() => adminUsers.id, { onDelete: "set null" }),
    // Snapshot del nombre al marcar: sobrevive al borrado del usuario.
    loadedByName: text("loaded_by_name"),
    // Pago REAL creado en Alegra desde el backoffice (ver migración 0024). Con id cargado no hay
    // deshacer ni re-carga: la guarda es el UPDATE condicional `alegra_payment_id IS NULL`.
    alegraPaymentId: integer("alegra_payment_id"),
    // Número legible del pago en Alegra (ej. recibo de caja), para mostrar sin pegarle a la API.
    alegraPaymentNumber: text("alegra_payment_number"),
    // Lo que el cliente DECLARÓ al informar, cuando el admin corrige monto/fecha al cargar
    // (el comprobante manda). NULL = cargado con los datos declarados.
    declaredAmount: numeric("declared_amount", { precision: 14, scale: 2 }),
    declaredPaidOn: date("declared_paid_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payment_receipts_tenant_status_submitted_idx").on(
      t.tenantId,
      t.status,
      sql`${t.submittedAt} desc`,
    ),
    index("payment_receipts_tenant_cliente_created_idx").on(
      t.tenantId,
      t.codigocliente,
      sql`${t.createdAt} desc`,
    ),
  ],
)

// Proveedores de pago del tenant en el Shop (Configuración → Medios de pago / Cuotas).
// v2 (platform/contracts/cuotas/v2): una fila por proveedor con codigo_proveedor = "credito"
// (aplica a todas las tarjetas de crédito). Las filas v1 por marca (visa, master) quedan en la
// tabla y se ignoran. Tasas y sin interés los informa el proveedor (no viven acá).
export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    // Ej. "mercadopago".
    proveedor: text("proveedor").notNull(),
    // v2: siempre "credito" (CODIGO_CREDITO en src/lib/cuotas.ts). v1: "visa" | "master".
    codigoProveedor: text("codigo_proveedor").notNull(),
    nombre: text("nombre").notNull(),
    activo: boolean("activo").notNull().default(true),
    orden: integer("orden").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_methods_tenant_proveedor_codigo_uniq").on(t.tenantId, t.proveedor, t.codigoProveedor)],
)

// Escalones de cuotas por proveedor (v2): desde `montoMinimo` se ofrecen hasta `cuotas`
// (= cuotasMax). Aplican igual a TODOS los productos. "No dos escalones activos del mismo
// proveedor con el mismo monto mínimo" se valida en src/lib/cuotas-repo.ts con advisory lock.
// El CHECK de cuotas 1..24 vive en la migración 0026. sin_interes y vigencias son de v1 y
// quedan sin uso.
export const installmentOptions = pgTable(
  "installment_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    paymentMethodId: uuid("payment_method_id")
      .notNull()
      .references(() => paymentMethods.id, { onDelete: "cascade" }),
    // cuotasMax del escalón (1..24).
    cuotas: integer("cuotas").notNull(),
    // v1, sin uso en v2 (el sin interés lo informa el proveedor con tasa 0).
    sinInteres: boolean("sin_interes").notNull().default(false),
    // Con IVA, sobre el monto base (precio final, total del carrito o del pedido). String decimal.
    montoMinimo: numeric("monto_minimo", { precision: 14, scale: 2 }).notNull().default("0"),
    // v1, sin uso en v2 (quedan null).
    vigenteDesde: date("vigente_desde"),
    vigenteHasta: date("vigente_hasta"),
    activo: boolean("activo").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Id del admin que hizo el último cambio (auditoría liviana).
    updatedBy: text("updated_by"),
  },
  (t) => [
    index("installment_options_tenant_idx").on(t.tenantId),
    index("installment_options_method_cuotas_idx").on(t.paymentMethodId, t.cuotas),
  ],
)

// Versión de la configuración de cuotas por tenant: se pisa `updatedAt` en CADA escritura de
// proveedores o escalones (incluidos borrados), así `actualizadoEn` del contrato v2 cambia
// aunque la fila modificada ya no exista. Migración 0026.
export const paymentConfigVersions = pgTable("payment_config_versions", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
