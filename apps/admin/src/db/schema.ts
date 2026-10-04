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
  foreignKey,
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
    /**
     * Para el precio final con IVA. SUMA de raw.tax (alegra-impuestos.ts = alegra_suma_impuestos,
     * 0037): la escribe el mapper de la sync y del webhook; no es generada a propósito.
     */
    ivaPorcentaje: numeric("iva_porcentaje", { precision: 5, scale: 2 }),
    /** El ítem COMPLETO como lo devuelve Alegra. Nada se descarta. ~2,5 KB por ítem. */
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    /**
     * Precios crudos de Alegra (raw->'price'), generada STORED (0037) para que la vista
     * catalog_products_shop no destoastee `raw` en cada lectura del Shop. raw NULL → [].
     */
    preciosAlegra: jsonb("precios_alegra").generatedAlwaysAs(sql`coalesce("raw"->'price', '[]'::jsonb)`),
    images: jsonb("images").notNull().default([]),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Momento en que se le PIDIÓ a Alegra el dato de esta fila (la sync pasa su inicio; el
     * webhook, el instante previo a su GET). El upsert sólo pisa las columnas de Alegra si su
     * lectura es igual o más nueva (lib/catalog-products-repo.ts). NULL = −∞ (filas viejas).
     */
    alegraLeidoAt: timestamp("alegra_leido_at", { withTimezone: true }),
    /** Quién hizo esa lectura: 'sync' | 'webhook'. */
    leidoPor: text("leido_por"),
    /**
     * Cuenta de Alegra de la que sale la fila (change `sucursales-igz-mdp`, rebanada D, catálogo
     * unión). NULL = cuenta PRINCIPAL del tenant (todas las filas de hoy). Una fila con `cuentaId`
     * es un producto que vive SOLO en esa cuenta secundaria. `stock` = stock de la cuenta de origen.
     */
    cuentaId: uuid("cuenta_id").references((): AnyPgColumn => alegraCuentas.id),
    /** Id del ítem en SU cuenta de origen. NULL = igual a `alegraId` (filas de la principal). */
    alegraIdCuenta: text("alegra_id_cuenta"),
    /** Si otra fila absorbió a esta (mismo código dado de alta en la principal): su `alegraId`. */
    reemplazadoPorAlegraId: text("reemplazado_por_alegra_id"),
  },
  (t) => [
    uniqueIndex("cp_tenant_alegra").on(t.tenantId, t.alegraId),
    index("cp_tenant_cuenta").on(t.tenantId, t.cuentaId),
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
    status: text("status").notNull().default("running"), // 'running' | 'ok' | 'parcial' (guarda, lib/alegra-sync-guarda.ts) | 'error'
    itemsSynced: integer("items_synced").notNull().default(0),
    categoriesSynced: integer("categories_synced").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Cuenta que sincronizó esta corrida. NULL = la principal (change `sucursales-igz-mdp`, D). */
    cuentaId: uuid("cuenta_id").references((): AnyPgColumn => alegraCuentas.id),
    /**
     * Detalle de la corrida de una cuenta secundaria (0043): pareados, solo-secundaria y los
     * "Códigos a revisar". Forma en `ResumenSync` (lib/alegra-sync-cuenta.ts). NULL en la principal.
     */
    resumen: jsonb("resumen"),
    /**
     * Última señal de vida de una corrida por tramos (0047). Una fila 'running' sin actividad hace
     * más de VENTANA_CORRIDA_EN_CURSO_MIN se considera abandonada. NULL = se usa `started_at`.
     */
    actividadAt: timestamp("actividad_at", { withTimezone: true }),
  },
  (t) => [index("csl_tenant_started").on(t.tenantId, t.startedAt)],
)

// Cursor de la sync reanudable por tramos (0047): una fila por tenant mientras haya una corrida
// a medias (cuenta actual, offset de lectura, resultados ya cerrados). Forma en `CursorSync`
// (lib/alegra-sync-tenant.ts). Se borra al terminar la corrida. `lockHasta` = tramo en ejecución.
export const catalogSyncCursor = pgTable("catalog_sync_cursor", {
  tenantId: text("tenant_id").primaryKey().references(() => tenants.id),
  cursor: jsonb("cursor").notNull(),
  lockHasta: timestamp("lock_hasta", { withTimezone: true }),
  actividadAt: timestamp("actividad_at", { withTimezone: true }).notNull().defaultNow(),
})

// ── Stock casi en tiempo real: avisos de Alegra (change `webhooks-stock-alegra`) ───────────
//
// Un aviso de factura/compra/ítem NO trae el stock que vale: es sólo un disparador. La ruta
// encola los ids de ítems (dedupe por PK) y un drenador único por tenant los re-lee con
// GET /items/{id} a ritmo fijo (lib/alegra-stock-cola.ts). Ninguna tabla guarda datos del
// documento (cliente, proveedor, montos): sólo ids.

// Cola de ítems a re-leer. Re-encolar uno pendiente actualiza `pedido_at` y resetea intentos.
export const alegraItemRefresh = pgTable(
  "alegra_item_refresh",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    alegraId: text("alegra_id").notNull(),
    /** Último aviso que lo pidió. */
    pedidoAt: timestamp("pedido_at", { withTimezone: true }).notNull().defaultNow(),
    /** Evento que lo encoló (el último). */
    motivo: text("motivo").notNull(),
    intentos: integer("intentos").notNull().default(0),
    /** Lease de la fila: mientras no venza, otro drenador no la toma. */
    tomadoHasta: timestamp("tomado_hasta", { withTimezone: true }),
    /** Motivo corto (`alegra_http_500`, `db_XXXXX`), nunca el mensaje de Alegra. */
    ultimoError: text("ultimo_error"),
  },
  (t) => [
    primaryKey({ name: "air_pk", columns: [t.tenantId, t.alegraId] }),
    index("air_tenant_pedido").on(t.tenantId, t.pedidoAt),
  ],
)

// Índice documento→ítems: qué ítems tenía cada factura/compra según el último aviso. Cubre el
// `delete-invoice` (llega con items vacío) y los ítems que una edición quitó.
export const alegraDocumentoItems = pgTable(
  "alegra_documento_items",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    tipo: text("tipo").notNull(), // 'invoice' | 'bill'
    alegraDocId: text("alegra_doc_id").notNull(),
    itemIds: text("item_ids").array().notNull().default(sql`'{}'::text[]`),
    /** status (invoice) / state (bill) del último aviso. */
    estado: text("estado"),
    actualizadoAt: timestamp("actualizado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "adi_pk", columns: [t.tenantId, t.tipo, t.alegraDocId] })],
)

// Lease por tenant: un solo drenador a la vez (sin locks de sesión: el pooler de Neon va en
// modo transacción). Se auto-libera si la función muere.
export const alegraStockDrenaje = pgTable("alegra_stock_drenaje", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  ocupadoHasta: timestamp("ocupado_hasta", { withTimezone: true }),
  ultimoDrenajeAt: timestamp("ultimo_drenaje_at", { withTimezone: true }),
})

// Avisos recibidos por tenant, día y evento: para detectar que dejaron de llegar (Alegra puede
// desactivar una suscripción sin avisar).
export const alegraWebhookAvisos = pgTable(
  "alegra_webhook_avisos",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    /** Fecha en America/Argentina/Buenos_Aires. */
    dia: date("dia").notNull(),
    evento: text("evento").notNull(),
    cantidad: integer("cantidad").notNull().default(0),
    ultimoAt: timestamp("ultimo_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "awa_pk", columns: [t.tenantId, t.dia, t.evento] })],
)

// ── Espejo de contactos de Alegra (change `espejo-contactos-alegra`) ──────────────────────
//
// Copia del padrón de contactos de cada cuenta de Alegra, poblada por una sync completa y
// pausada (lib/alegra-contacts-sync.ts). Sirve para no bajar el padrón en vivo: antes buscar
// por teléfono o listar clientes costaba ~200 requests contra una cuota compartida.
//
// OJO: el Shop NO lee esta tabla sino la vista `public.alegra_contacts_shop` (migraciones
// 0031/0032/0034/0036/0039, vive solo en SQL; 0039 suma `acceso_facturacion`, calculada con
// `contactos_acceso_facturacion`), y la actualiza sólo vía la función SECURITY DEFINER
// `public.shop_contacto_write_through` (0034, también sólo en SQL). Si cambia o se borra una
// columna expuesta en esa vista, hay que recrear la vista EN LA MISMA MIGRACIÓN.
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
    // Datos de facturación derivados de `raw` (0034, change `contacto-fuente-unica`). Vacío,
    // espacios, clave ausente o forma inesperada ⇒ NULL. Expresiones IDÉNTICAS al .sql;
    // casos en test/integration/alegra-contacts-schema.integration.test.ts.
    ivaCondition: text("iva_condition").generatedAlwaysAs(sql`NULLIF(btrim("raw"->>'ivaCondition'), '')`),
    identificationType: text("identification_type").generatedAlwaysAs(
      sql`NULLIF(btrim("raw"->'identificationObject'->>'type'), '')`,
    ),
    identificationNumber: text("identification_number").generatedAlwaysAs(
      sql`NULLIF(btrim("raw"->'identificationObject'->>'number'), '')`,
    ),
    addressStreet: text("address_street").generatedAlwaysAs(sql`NULLIF(btrim("raw"->'address'->>'address'), '')`),
    addressCity: text("address_city").generatedAlwaysAs(sql`NULLIF(btrim("raw"->'address'->>'city'), '')`),
    addressProvince: text("address_province").generatedAlwaysAs(sql`NULLIF(btrim("raw"->'address'->>'province'), '')`),
    addressPostalCode: text("address_postal_code").generatedAlwaysAs(
      sql`NULLIF(btrim("raw"->'address'->>'postalCode'), '')`,
    ),
    /** Estado real del contacto en Alegra. */
    alegraStatus: text("alegra_status"),
    /** NO es el estado de Alegra: "visto en la última corrida OK" ('active' | 'inactive'). */
    status: text("status").notNull().default("active"),
    /** Último que escribió la fila: 'sync' | 'fallback' | 'write_through' | 'webhook'. */
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

// Excepción de acceso a Facturación de Mi cuenta del Shop, por CONTACTO de Alegra (empresa),
// change `clientes-tienda-admin` (0039). Hoy el Shop sólo muestra Facturación a los contactos en
// cuenta corriente; un admin/superadmin del CRM puede otorgarla a un contacto de contado.
//  - Una fila por otorgamiento; quitar = UPDATE de revocado_* (nunca DELETE: el historial queda).
//  - A lo sumo UNA vigente por (tenant, cuenta, contacto): índice parcial `caf_vigente`.
//  - otorgado_por / revocado_por sin FK a admin_users: el nombre queda congelado y el historial
//    sobrevive a la baja del usuario (patrón `estado_actualizado_por_nombre`).
//  - CHECK `caf_revocacion_completa` (revocado_en y revocado_por van juntos): vive SÓLO en el
//    .sql, como el resto de los CHECK de esta app.
//  - Sin FK a alegra_contacts: la sync reescribe esa tabla por upsert y un contacto puede salir
//    del espejo; la excepción queda registrada y la vista la ignora mientras no esté activo.
// El Shop NO lee esta tabla (sin GRANT a shop_app): ve sólo `alegra_contacts_shop.acceso_facturacion`.
export const contactosAccesoFacturacion = pgTable(
  "contactos_acceso_facturacion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    alegraAccount: text("alegra_account").notNull().default("principal"),
    alegraId: text("alegra_id").notNull(),
    otorgadoPor: uuid("otorgado_por").notNull(),
    otorgadoPorNombre: text("otorgado_por_nombre").notNull(),
    otorgadoEn: timestamp("otorgado_en", { withTimezone: true }).notNull().defaultNow(),
    revocadoPor: uuid("revocado_por"),
    revocadoPorNombre: text("revocado_por_nombre"),
    revocadoEn: timestamp("revocado_en", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("caf_vigente")
      .on(t.tenantId, t.alegraAccount, t.alegraId)
      .where(sql`"revocado_en" IS NULL`),
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

/**
 * La ficha técnica (PDF) de un producto, o null si no tiene. Igual que las fotos: se guarda la
 * KEY del objeto en R2, nunca la URL (la url se compone al leer, en `urlPublicaFicha()`).
 * `nombre` es el nombre del archivo original (para el link de descarga) y `bytes` su tamaño.
 */
export interface FichaTecnicaOverlay {
  key: string
  nombre: string
  bytes: number
  /**
   * sha256 (hex) del PDF. Presente cuando la key es POR CONTENIDO (`fichaContenidoKey`): varios
   * productos pueden compartir el mismo objeto. El Shop sólo usa `key`: los campos extra son
   * inertes para él.
   */
  sha256?: string
  /**
   * La key de antes de pasar a contenido (la copia propia del producto). Se conserva como
   * respaldo para `revertir`; no se borra del bucket sin una orden explícita.
   */
  origen?: { key: string; bytes: number }
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
    // Ficha técnica (PDF), opcional. A diferencia de `fotos` (array de variantes) es un solo
    // archivo: null = sin ficha cargada.
    fichaTecnica: jsonb("ficha_tecnica").$type<FichaTecnicaOverlay | null>(),
    // Slugs de `sucursales` donde el producto NO se ofrece (vacío = visible en todas). Sin FK
    // (array): la API del admin valida los slugs. Migración 0045; el Shop la lee directo del
    // overlay (GRANT por columna) solo con el flag `disponibilidad-sucursal`.
    ocultoEnSucursales: text("oculto_en_sucursales").array().notNull().default(sql`'{}'::text[]`),
    // false = el Shop no exhibe la marca de este producto (ni en la card, ni en la ficha, ni en el
    // filtro de marcas). Migración 0048; el Shop la lee directo del overlay (GRANT por columna).
    mostrarMarca: boolean("mostrar_marca").notNull().default(true),
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
    // Id de contacto en Alegra, de la SESIÓN del portal (nunca del body). NULL (0056) = comprador
    // de la tienda sin cuenta corriente: entonces hay `shopOrderId` + `clerkUserId` (CHECK).
    codigocliente: text("codigocliente"),
    // Pedido de la tienda (`shop.orders.id`) al que corresponde; sin FK (otro esquema).
    shopOrderId: uuid("shop_order_id"),
    // Quién lo subió en el Shop; dueño del comprobante cuando no hay `codigocliente`.
    clerkUserId: text("clerk_user_id"),
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
    index("payment_receipts_tenant_pedido_idx").on(t.tenantId, t.shopOrderId),
    index("payment_receipts_tenant_clerk_created_idx").on(
      t.tenantId,
      t.clerkUserId,
      sql`${t.createdAt} desc`,
    ),
  ],
)

// Proveedores de pago del tenant en el Shop (Pagos y cuotas).
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
    // Cantidad de cuotas a mostrar en card y ficha del Shop (2..24, CHECK en la migración 0062).
    // NULL = Automático (mayor sin interés; si no hay, la mayor con interés).
    cuotasCatalogo: smallint("cuotas_catalogo"),
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

// ── Sucursales y zonas (change `sucursales-igz-mdp`, rebanada A) ───────────────────────────
//
// La sucursal es la unidad comercial (zona, retiro, reserva); no se confunde con la cuenta de
// Alegra que factura (esa relación llega en la rebanada D). Todos los valores (direcciones,
// WhatsApp, horarios) se cargan por el admin: la migración crea solo estructura. El Shop lee
// estas tablas con `shop_app` (GRANT por columna en la migración 0041).
//
// Drift que vive SOLO en SQL: el CHECK del slug (`^[a-z0-9-]{2,20}$`) y los GRANTs.
export const sucursales = pgTable(
  "sucursales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    // Estable e inmutable: `shop.orders.sucursal` la guarda como texto, sin FK entre esquemas.
    slug: text("slug").notNull(),
    nombre: text("nombre").notNull(),
    direccion: text("direccion").notNull().default(""),
    ciudad: text("ciudad").notNull().default(""),
    provincia: text("provincia").notNull().default(""),
    whatsapp: text("whatsapp").notNull().default(""),
    horario: text("horario").notNull().default(""),
    aceptaRetiro: boolean("acepta_retiro").notNull().default(true),
    aceptaEnvio: boolean("acepta_envio").notNull().default(true),
    // Ciudades a las que envía esta sucursal; vacío = toda su zona.
    envioCiudades: text("envio_ciudades").array().notNull().default(sql`'{}'::text[]`),
    orden: integer("orden").notNull().default(0),
    // Baja lógica: nunca se borra una sucursal que algún pedido usa.
    activa: boolean("activa").notNull().default(true),
    // Una por tenant: destino de las provincias sin zona.
    predeterminada: boolean("predeterminada").notNull().default(false),
    // Una por tenant: la de la cuenta de Alegra maestra del catálogo.
    maestra: boolean("maestra").notNull().default(false),
    // Reservada por si una sola cuenta de Alegra sirve a dos sucursales (no se usa todavía).
    depositoAlegraId: text("deposito_alegra_id"),
    // Cuenta de Alegra que factura y de la que se sincroniza el stock de esta sucursal (rebanada
    // D). NULL = sin asignar. FK compuesta (tenant_id, cuenta_alegra_id): no cruza tenants. NO la
    // lee el Shop (GRANT por columna de 0041).
    cuentaAlegraId: uuid("cuenta_alegra_id"),
    // Destino del aviso "pedido nuevo" del Shop (0054). NULL = sin destinatario propio: el Shop
    // cae a `tenants.receipts_email`. Lo lee el Shop (GRANT por columna de 0054).
    emailPedidos: text("email_pedidos"),
    // Horario semanal y excepciones PROPIOS de la sucursal (0051), mismo shape que `tenants`.
    // '{}' = sin horario configurado. Los lee el Shop (GRANT por columna de 0051) y el endpoint
    // interno business-hours; los edita Admin → Horarios. `horario` (texto libre) queda deprecado.
    schedule: jsonb("schedule").$type<WeeklySchedule>().notNull().default(sql`'{}'::jsonb`),
    scheduleExceptions: jsonb("schedule_exceptions").$type<ScheduleException[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "sucursales_cuenta_alegra_fk",
      columns: [t.tenantId, t.cuentaAlegraId],
      foreignColumns: [alegraCuentas.tenantId, alegraCuentas.id],
    }),
    // UNIQUE completo (no parcial): lo necesitan las FK compuestas de `zonas`.
    uniqueIndex("sucursales_tenant_slug_uniq").on(t.tenantId, t.slug),
    uniqueIndex("sucursales_predeterminada_uniq").on(t.tenantId).where(sql`${t.predeterminada}`),
    uniqueIndex("sucursales_maestra_uniq").on(t.tenantId).where(sql`${t.maestra}`),
  ],
)

// Zona = provincia -> sucursal. Una fila por provincia y tenant; sin fila, rige la
// predeterminada. `provinciaClave` es el nombre normalizado (mayúsculas/tildes/espacios).
export const zonas = pgTable(
  "zonas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    provinciaClave: text("provincia_clave").notNull(),
    provincia: text("provincia").notNull(),
    sucursal: text("sucursal").notNull(),
    // Sucursal cuya cuenta factura las ventas de esta zona, si difiere de la que despacha.
    facturaSucursal: text("factura_sucursal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("zonas_tenant_provincia_uniq").on(t.tenantId, t.provinciaClave),
    foreignKey({
      name: "zonas_sucursal_fk",
      columns: [t.tenantId, t.sucursal],
      foreignColumns: [sucursales.tenantId, sucursales.slug],
    }),
    foreignKey({
      name: "zonas_factura_sucursal_fk",
      columns: [t.tenantId, t.facturaSucursal],
      foreignColumns: [sucursales.tenantId, sucursales.slug],
    }),
  ],
)

// Reglas de venta por tenant (change `sucursales-igz-mdp`, rebanada B; migración 0045). Una fila
// por tenant; si falta, rigen los mismos defaults en código (`reglas-venta-validacion.ts`).
// Drift que vive SOLO en SQL: los CHECK (enteros >= 0; `retiro_sin_stock` en bloquear/ofrecer), la
// siembra de filas por tenant y el GRANT SELECT a `shop_app`.
export const reglasVenta = pgTable("reglas_venta", {
  tenantId: text("tenant_id").primaryKey().references(() => tenants.id),
  // Envío: si la sucursal de la zona no tiene stock, se despacha desde otra ("a traer").
  respaldoEnvio: boolean("respaldo_envio").notNull().default(true),
  // Retiro sin stock en el local: 'bloquear' o 'ofrecer' (con demora de `traslado_dias`).
  retiroSinStock: text("retiro_sin_stock").notNull().default("ofrecer"),
  // Días de demora prometidos al traer de otra sucursal (0 = "a coordinar").
  trasladoDias: integer("traslado_dias").notNull().default(7),
  // Días que un pedido sin cobro online reserva stock (0 = nunca vence).
  reservaDias: integer("reserva_dias").notNull().default(7),
  // Horas sin contactar tras las cuales el pedido se resalta en Pedidos.
  avisoSinContactarHoras: integer("aviso_sin_contactar_horas").notNull().default(24),
  // Horas hábiles que se le prometen al cliente para el contacto.
  contactoHorasHabiles: integer("contacto_horas_habiles").notNull().default(24),
  // Mensaje de confirmación que ve el cliente al terminar la compra (migración 0046). Vacío = texto
  // por defecto del Shop. Variables `{plazo}` y `{whatsapp}` que reemplaza el Shop.
  mensajeConfirmacion: text("mensaje_confirmacion").notNull().default(""),
  // Envío configurable (migración 0049, change `envio-gratis-configurable`). Dos interruptores:
  // domicilio (se ofrece, con costo a coordinar) y gratis (apagado al migrar). Alcance, provincias
  // y mínimo sólo aplican con gratis activo; NULL = sin configurar. Los CHECK viven sólo en SQL.
  envioDomicilioActivo: boolean("envio_domicilio_activo").notNull().default(true),
  envioGratisActivo: boolean("envio_gratis_activo").notNull().default(false),
  // 'pais' | 'provincias'
  envioGratisAlcance: text("envio_gratis_alcance"),
  // Claves de provincia (`claveProvincia`), como `zonas.provincia_clave`.
  envioGratisProvincias: text("envio_gratis_provincias").array().notNull().default(sql`'{}'::text[]`),
  // 'sin_minimo' | 'desde'
  envioGratisMinimoModo: text("envio_gratis_minimo_modo"),
  // Sin impuestos; sólo con modo 'desde'.
  envioGratisMinimo: numeric("envio_gratis_minimo", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

// Medios de pago del checkout del Shop (change `sucursales-igz-mdp`, rebanada C; migración 0046).
// Tabla APARTE de `payment_methods` (esa es de proveedores de cuotas: decisión O10). Una fila por
// medio y tenant; `slug` es lo que el Shop guarda en `shop.orders.pago_metodo` (sin FK entre
// esquemas), por eso es inmutable y no se borra si algún pedido lo usa (se desactiva).
// `instrucciones` es el texto que ve el cliente al elegirlo. `cobro_online` queda reservado
// (todavía sin uso: ningún medio de esta tabla cobra online).
//
// Drift que vive SOLO en SQL: el CHECK del slug (`^[a-z0-9-]{2,30}$`), la siembra por tenant y el
// GRANT SELECT a `shop_app`.
export const mediosPagoShop = pgTable(
  "medios_pago_shop",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    slug: text("slug").notNull(),
    nombre: text("nombre").notNull(),
    instrucciones: text("instrucciones").notNull().default(""),
    activo: boolean("activo").notNull().default(true),
    aplicaRetiro: boolean("aplica_retiro").notNull().default(true),
    aplicaEnvio: boolean("aplica_envio").notNull().default(true),
    cobroOnline: boolean("cobro_online").notNull().default(false),
    orden: integer("orden").notNull().default(0),
    // Lista de precios de Alegra (cuenta principal) enlazada al medio; NULL = lista por defecto.
    // `listaPreciosNombre` es un snapshot para avisar si la lista se da de baja en Alegra.
    idListaPrecios: text("id_lista_precios"),
    listaPreciosNombre: text("lista_precios_nombre"),
    // A lo sumo un medio por tenant (índice único parcial); `mostrarEnFicha` no tiene límite.
    destacarEnCatalogo: boolean("destacar_en_catalogo").notNull().default(false),
    mostrarEnFicha: boolean("mostrar_en_ficha").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("medios_pago_shop_tenant_slug_uniq").on(t.tenantId, t.slug),
    uniqueIndex("medios_pago_shop_tenant_destacado_uniq").on(t.tenantId).where(sql`${t.destacarEnCatalogo} = true`),
  ],
)

// ── Cuentas bancarias del Shop (change `pago-transferencia-comprobante`, rebanada A) ─────────
//
// Cuentas a las que el cliente transfiere. El Shop elige una por sucursal y monto (menor `orden`
// entre las que cumplen; la predeterminada es respaldo y compite como cualquiera). Sin datos reales
// en el repo: se cargan por el admin.
//
// Drift que vive SOLO en SQL: los CHECKs (CBU 22 dígitos, CUIT 11 o vacío, todas OR >=1 sucursal,
// rango de montos, predeterminada => activa), el índice único parcial de la predeterminada y el
// GRANT SELECT por columna a `shop_app`.
export const cuentasBancariasShop = pgTable(
  "cuentas_bancarias_shop",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    alias: text("alias").notNull(),
    cbu: text("cbu").notNull(),
    banco: text("banco").notNull().default(""),
    titular: text("titular").notNull().default(""),
    cuit: text("cuit").notNull().default(""),
    // "Todas las sucursales" es una elección explícita; false exige al menos un slug.
    todasLasSucursales: boolean("todas_las_sucursales").notNull().default(false),
    sucursalSlugs: text("sucursal_slugs").array().notNull().default(sql`'{}'::text[]`),
    // NULL = sin límite. Rango inclusivo sobre el total con impuestos.
    montoMin: numeric("monto_min", { precision: 14, scale: 2 }),
    montoMax: numeric("monto_max", { precision: 14, scale: 2 }),
    activa: boolean("activa").notNull().default(true),
    predeterminada: boolean("predeterminada").notNull().default(false),
    orden: integer("orden").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cuentas_bancarias_shop_tenant_cbu_uniq").on(t.tenantId, t.cbu)],
)

// ── Cuentas de Alegra y stock por sucursal (change `sucursales-igz-mdp`, rebanada D) ───────
//
// La sucursal es la unidad comercial; la CUENTA de Alegra es la unidad contable (credenciales,
// CUIT, sync). `sucursales.cuenta_alegra_id` las une (N:1).
//
// La cuenta PRINCIPAL (`principal = true`, una por tenant, creada por la migración 0042) NO
// guarda credenciales: reutiliza las de `tenants` (`configParaCuenta`), así no hay dos copias del
// token. Las secundarias guardan email/token acá; la API NUNCA devuelve el token y `shop_app` no
// tiene ningún permiso sobre esta tabla. (Cifrado en reposo: pendiente, igual que `tenants`.)
//
// Drift que vive SOLO en SQL: el CHECK del slug (`^[a-z0-9-]{2,12}$`, entra en el `alegra_id`
// sintético `<slug>:<id>` de los productos solo-secundaria), el índice único parcial de
// `principal` y los GRANTs.
export const alegraCuentas = pgTable(
  "alegra_cuentas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    // Inmutable una vez creada.
    slug: text("slug").notNull(),
    nombre: text("nombre").notNull(),
    // Solo dígitos (11), validado con dígito verificador en la app. '' = sin cargar.
    cuit: text("cuit").notNull().default(""),
    alegraEmail: text("alegra_email").notNull().default(""),
    alegraToken: text("alegra_token").notNull().default(""),
    alegraMock: boolean("alegra_mock").notNull().default(false),
    // La que manda en los productos repetidos. Una por tenant.
    principal: boolean("principal").notNull().default(false),
    activa: boolean("activa").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("alegra_cuentas_tenant_slug_uniq").on(t.tenantId, t.slug),
    // Lo necesita la FK compuesta de `sucursales`.
    uniqueIndex("alegra_cuentas_tenant_id_uniq").on(t.tenantId, t.id),
    uniqueIndex("alegra_cuentas_principal_uniq").on(t.tenantId).where(sql`${t.principal}`),
  ],
)

// Stock de cada producto en cada sucursal (una fila por producto × sucursal). `alegraId` es el
// `alegra_id` de la fila de `catalog_products` (real o sintético `<slug>:<id>`); `itemIdCuenta`
// es el id del ítem en la cuenta de ESA sucursal (pareo). Fila ausente = 0 solo para ítems
// inventariables. El Shop lee (tenant_id, sucursal, alegra_id, stock, leido_at), sin `item_id_cuenta`.
//
// Drift que vive SOLO en SQL: CHECK de `origen` y GRANT por columna.
export const catalogStockSucursal = pgTable(
  "catalog_stock_sucursal",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    sucursal: text("sucursal").notNull(),
    alegraId: text("alegra_id").notNull(),
    itemIdCuenta: text("item_id_cuenta"),
    stock: numeric("stock").notNull().default("0"),
    // 'sync' | 'webhook' | 'factura' | 'manual' ('manual' = par forzado desde el admin; el sync no lo pisa)
    origen: text("origen").notNull(),
    leidoAt: timestamp("leido_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "css_pk", columns: [t.tenantId, t.sucursal, t.alegraId] }),
    uniqueIndex("css_sucursal_item_uniq").on(t.tenantId, t.sucursal, t.itemIdCuenta).where(sql`${t.itemIdCuenta} is not null`),
    foreignKey({
      name: "css_sucursal_fk",
      columns: [t.tenantId, t.sucursal],
      foreignColumns: [sucursales.tenantId, sucursales.slug],
    }).onDelete("cascade"),
  ],
)

// ── Cuenta de Alegra que factura cada pedido (change `sucursales-igz-mdp`, rebanada D, lote 3) ──
//
// Una fila por pedido cuando el operador eligió otra cuenta o cuando se emitió una factura. El
// DEFAULT (cuenta de la sucursal que despacha, o la de la zona si la regla lo fuerza) NO se guarda:
// se calcula (`resolverCuentaFactura`). `order_id` referencia `shop.orders.id` SIN FK (otro
// esquema, dueño Shop): esta tabla es del CRM a propósito para no pedirle una columna al Shop.
//
//  - `cuenta_override_id` + `override_*`: la elección del operador y su auditoría (quién, cuándo y
//    la cuenta que había antes; NULL = era el default). El historial del pedido no admite tipos de
//    evento nuevos (CHECK del Shop), por eso la auditoría vive acá.
//  - `factura_cuenta_id` / `factura_cruzada`: la cuenta con la que SE EMITIÓ la factura y si difiere
//    de la sucursal que despacha (la reserva de stock sigue en la que despacha, rebanada B). Se
//    limpian al desvincular la factura.
//
// `shop_app` NO tiene permiso sobre esta tabla (rebanada B decide si necesita `factura_cruzada`).
export const pedidoFacturaCuenta = pgTable(
  "pedido_factura_cuenta",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    orderId: uuid("order_id").notNull(),
    cuentaOverrideId: uuid("cuenta_override_id"),
    overridePor: text("override_por"),
    overridePorNombre: text("override_por_nombre"),
    overrideEn: timestamp("override_en", { withTimezone: true }),
    overrideAnteriorId: uuid("override_anterior_id"),
    facturaCuentaId: uuid("factura_cuenta_id"),
    facturaCruzada: boolean("factura_cruzada").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "pfc_pk", columns: [t.tenantId, t.orderId] }),
    foreignKey({
      name: "pfc_override_fk",
      columns: [t.tenantId, t.cuentaOverrideId],
      foreignColumns: [alegraCuentas.tenantId, alegraCuentas.id],
    }),
    foreignKey({
      name: "pfc_anterior_fk",
      columns: [t.tenantId, t.overrideAnteriorId],
      foreignColumns: [alegraCuentas.tenantId, alegraCuentas.id],
    }),
    foreignKey({
      name: "pfc_factura_fk",
      columns: [t.tenantId, t.facturaCuentaId],
      foreignColumns: [alegraCuentas.tenantId, alegraCuentas.id],
    }),
  ],
)

// ── Atributos técnicos estructurados del catálogo (fase 2 del catálogo asistido, subproyecto 5) ──
//
// Una fila por (producto, clave). `alegraId` es el de `catalog_products` (sin FK: igual que el
// overlay, puede preceder al espejo). Las numéricas van en `valorNum` (potencia_w, temperatura_k,
// flujo_lm, tension_v, ip) y las categóricas en `valorTexto` (tono, zocalo; tension_v de rango
// guarda además "85-265" en `valorTexto`).
//
// Precedencia de `fuente`: manual > pdf > nombre. Una escritura NUNCA pisa una fila de mayor
// precedencia (lo hace cumplir el upsert de `lib/catalogo-atributos-repo.ts` en SQL).
//
// Drift que vive SOLO en SQL (como 0046): los CHECK de `clave` y `fuente` y el GRANT por columna
// a `shop_app` (tenant_id, alegra_id, clave, valor_num, valor_texto). Migración 0049; la 0053
// amplió el CHECK de `clave` a 18: potencia_w, temperatura_k, tono, ip, flujo_lm, tension_v,
// zocalo, corriente_a, polos, seccion_mm2, medidas_mm, color, poder_corte_ka, curva,
// sensibilidad_ma, largo_m, montaje, angulo_grados; la 0058 sumó leds_m y potencia_w_m (20 claves); la 0059, leds_rollo (21).
// Textuales: tono, zocalo, medidas_mm, color,
// curva, montaje; el resto va en `valorNum`.
export const catalogAtributos = pgTable(
  "catalog_atributos",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    alegraId: text("alegra_id").notNull(),
    clave: text("clave").notNull(),
    valorNum: numeric("valor_num"),
    valorTexto: text("valor_texto"),
    // 'nombre' | 'pdf' | 'manual'
    fuente: text("fuente").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "catalog_atributos_pk", columns: [t.tenantId, t.alegraId, t.clave] })],
)

// Nombre que el admin le da a cada canal de entrada del inbox (un número de WhatsApp por
// sucursal, la cuenta de Instagram...). `channel_account_id` es el id de la cuenta en ai-api,
// sin FK entre bases. Sin fila, la solapa del inbox muestra el teléfono o el nombre del canal.
export const inboxCanales = pgTable(
  "inbox_canales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    channelAccountId: text("channel_account_id").notNull(),
    nombre: text("nombre").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inbox_canales_tenant_cuenta_uniq").on(t.tenantId, t.channelAccountId)],
)

// Correo compartido (Resend Inboxes). Los mensajes, asuntos, remitentes y adjuntos viven en
// Resend: acá solo hay casillas, quién accede a cada una y un espejo mínimo (ids, carpeta,
// leído) para el badge y el push sin pegarle a Resend. Sin PII de cuerpos.
//
// `resend_inbox_id` es único global: el webhook resuelve el tenant por la inbox del evento.
export const correoCasillas = pgTable(
  "correo_casillas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    resendInboxId: text("resend_inbox_id").notNull().unique(),
    email: text("email").notNull(),
    nombre: text("nombre").notNull(),
    activa: boolean("activa").notNull().default(true),
    orden: integer("orden").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("correo_casillas_tenant_idx").on(t.tenantId)],
)

// Usuarios con acceso explícito a una casilla. Admin y superadmin ven todas las activas del
// tenant sin necesidad de fila acá.
export const correoCasillaAccesos = pgTable(
  "correo_casilla_accesos",
  {
    casillaId: uuid("casilla_id").notNull().references(() => correoCasillas.id, { onDelete: "cascade" }),
    adminUserId: uuid("admin_user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ name: "correo_casilla_accesos_pk", columns: [t.casillaId, t.adminUserId] })],
)

// Espejo mínimo por hilo: carpeta y leído para el badge. `folder`: inbox | archive | spam | sent | trash.
export const correoHilos = pgTable(
  "correo_hilos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    casillaId: uuid("casilla_id").notNull().references(() => correoCasillas.id, { onDelete: "cascade" }),
    resendThreadId: text("resend_thread_id").notNull(),
    folder: text("folder").notNull().default("inbox"),
    leido: boolean("leido").notNull().default(false),
    ultimoEventoAt: timestamp("ultimo_evento_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("correo_hilos_casilla_thread_uniq").on(t.casillaId, t.resendThreadId),
    index("correo_hilos_casilla_folder_leido_idx").on(t.casillaId, t.folder, t.leido),
  ],
)

// Idempotencia del webhook: un svix-id procesado no se reprocesa. Se limpia a los 30 días.
export const correoEventos = pgTable("correo_eventos", {
  svixId: text("svix_id").primaryKey(),
  recibidoAt: timestamp("recibido_at", { withTimezone: true }).notNull().defaultNow(),
})
