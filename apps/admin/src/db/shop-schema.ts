import { boolean, date, integer, numeric, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core"

// ─────────────────────────────────────────────────────────────────────────────────────────
// PROHIBIDO importar o re-exportar este archivo desde `src/db/schema.ts`.
//
// `drizzle.config.ts` del CRM apunta a ESE único archivo. Si estas tablas llegaran ahí,
// `drizzle-kit generate` emitiría `CREATE SCHEMA "shop"` / `CREATE TABLE "shop"."orders"` en
// una migración del CRM, y las dos apps pasarían a pelearse por el mismo DDL.
// El dueño del DDL del esquema `shop` es el Shop: `apps/clientes/drizzle`.
// Lo vigila `shop-schema-fuera-de-drizzle-kit.test.ts`.
// ─────────────────────────────────────────────────────────────────────────────────────────
//
// Qué es: un SUBCONJUNTO de `shop.orders` y `shop.order_items` (las columnas que el CRM lee o
// escribe), declarado a mano con nombres y tipos IDÉNTICOS a `apps/clientes/src/db/schema.ts`.
// No se importa el schema del Shop porque cada app tiene su propio `node_modules` (dos copias
// de drizzle-orm) y su propio Root Directory en Vercel.
//
// Cómo se evita la deriva: `test/integration/shop-schema-contrato.integration.test.ts` aplica
// las migraciones REALES del Shop a la base de test y compara cada columna declarada acá
// (existencia, tipo, nulabilidad) contra `information_schema`. También exige que acá estén
// todas las columnas NOT NULL sin default, para que los seeds de los tests puedan insertar.
//
// Se usa con el mismo `getDb()` de siempre y SÓLO con el core builder
// (`db.select().from(shopOrders)`): el nombre calificado `"shop"."orders"` sale de la propia
// tabla, así que no depende del `search_path` ni del objeto `schema` del cliente.

export const shop = pgSchema("shop")

export const shopOrders = shop.table("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  // GENERATED ALWAYS en la base: el CRM nunca lo escribe. Se declara como identity (y no como
  // integer pelado) para que el tipo del insert NO lo pida y drizzle mande DEFAULT; con un
  // valor explícito Postgres rechaza el insert.
  numero: integer("numero").notNull().generatedAlwaysAsIdentity(),
  // Slug de `public.tenants.id`. TODA consulta del CRM filtra por esta columna.
  tenantId: text("tenant_id").notNull(),

  // --- Cliente (snapshot al momento de comprar) ---
  clerkUserId: text("clerk_user_id"),
  clienteCodigo: text("cliente_codigo"),
  clienteRazonSocial: text("cliente_razon_social"),
  clienteCuit: text("cliente_cuit"),
  clienteEmail: text("cliente_email"),

  // --- Contacto del pedido ---
  contactoNombre: text("contacto_nombre").notNull(),
  contactoTelefono: text("contacto_telefono").notNull(),

  // --- Entrega ---
  entregaTipo: text("entrega_tipo").notNull(), // 'retiro' | 'envio'
  entregaCiudad: text("entrega_ciudad"),
  entregaDireccion: text("entrega_direccion"),

  // --- Facturación (copia congelada) ---
  facturacionTipoDoc: text("facturacion_tipo_doc"),
  facturacionNroDoc: text("facturacion_nro_doc"),
  facturacionRazonSocial: text("facturacion_razon_social"),
  facturacionCondicionIva: text("facturacion_condicion_iva"),
  facturacionDomicilio: text("facturacion_domicilio"),
  requiereRevision: boolean("requiere_revision").notNull().default(false),
  // Por qué (migración 0010 del Shop): 'documento_incompatible' | 'condicion_iva_desconocida' |
  // 'facturacion_en_pedido' | 'otra_lista_precios'. NULL en pedidos anteriores. Sin CHECK: un
  // valor que el CRM no conoce se muestra con el texto genérico. Requiere la 0010 aplicada.
  motivoRevision: text("motivo_revision"),

  // --- Pago ---
  // El CRM sólo escribe `pago_estado` (+ `pago_actualizado_en`) de los pagos OFFLINE, desde
  // "Registrar pago". Los online los mueve únicamente el webhook del proveedor, en el Shop.
  pagoMetodo: text("pago_metodo").notNull(),
  pagoEstado: text("pago_estado").notNull().default("pendiente"),
  // 'mercadopago' | 'mobbex' | 'modo' | null. null = pago offline.
  pagoProveedor: text("pago_proveedor"),
  pagoActualizadoEn: timestamp("pago_actualizado_en", { withTimezone: true }),
  // Operador que registró/anuló el último pago offline (0017 del Shop). Sin FK, como estadoActualizado*.
  pagoRegistradoPor: uuid("pago_registrado_por"),
  pagoRegistradoPorNombre: text("pago_registrado_por_nombre"),
  // 'cobro_duplicado' | 'pagado_cancelado' | null. Lo escribe el Shop al registrar cada cobro.
  pagoRevision: text("pago_revision"),

  // --- Estado + auditoría del último cambio ---
  estado: text("estado").notNull().default("pendiente"),
  // Dato INTERNO: el Shop nunca lo muestra. Obligatorio si estado = 'cancelado' (CHECK).
  cancelacionMotivo: text("cancelacion_motivo"),
  estadoActualizadoEn: timestamp("estado_actualizado_en", { withTimezone: true }),
  // `admin_users.id`. Sin FK: es otro esquema y el dueño del DDL es el Shop.
  estadoActualizadoPor: uuid("estado_actualizado_por"),
  estadoActualizadoPorNombre: text("estado_actualizado_por_nombre"),

  // --- Facturado en Alegra (0011 del Shop) + factura vinculada (0013 del Shop) ---
  // Las escribe SÓLO el CRM, las siete juntas: "Vincular factura" completa todas y
  // "Desvincular" las vacía (CHECK `orders_factura_facturado_check`: factura ⇒ facturado).
  // `facturado_en` no nulo saca al pedido de `shop.stock_reservado` (libera la reserva).
  facturadoEn: timestamp("facturado_en", { withTimezone: true }),
  // `admin_users.id`. Sin FK, como `estado_actualizado_por`.
  facturadoPor: uuid("facturado_por"),
  facturadoPorNombre: text("facturado_por_nombre"),
  facturaAlegraId: text("factura_alegra_id"),
  // Copia de lo que Alegra devolvió al vincular (número legible, fecha de emisión, total).
  facturaNumero: text("factura_numero"),
  facturaFecha: date("factura_fecha", { mode: "string" }),
  facturaTotal: numeric("factura_total", { precision: 14, scale: 2 }),

  // --- Totales congelados ---
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
  iva: numeric("iva", { precision: 14, scale: 2 }).notNull(),
  costoEnvio: numeric("costo_envio", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull(),

  // Aclaración que escribió el CLIENTE en el checkout (no confundir con el motivo interno).
  notas: text("notas"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const shopOrderItems = shop.table("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  // SIN `.references()`: la FK (on delete cascade) es del Shop y ya existe en la base.
  orderId: uuid("order_id").notNull(),
  alegraItemId: text("alegra_item_id").notNull(),
  code: text("code"),
  name: text("name").notNull(),
  brand: text("brand"),
  qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
  precioUnitario: numeric("precio_unitario", { precision: 14, scale: 2 }).notNull(),
  ivaPorcentaje: numeric("iva_porcentaje", { precision: 5, scale: 2 }).notNull(),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
  iva: numeric("iva", { precision: 14, scale: 2 }).notNull(),
  total: numeric("total", { precision: 14, scale: 2 }).notNull(),
})

export type ShopOrderRow = typeof shopOrders.$inferSelect
export type ShopOrderItemRow = typeof shopOrderItems.$inferSelect

// Espejo de los usuarios de Clerk de cada tienda (0018 del Shop). Lo escribe SÓLO el Shop
// (webhook + backfill, por las funciones `shop.clientes_*`); el CRM lo lee para el listado
// "Clientes de la tienda". Es el ancla del tenant de ese listado: `client_links` no tiene
// tenant_id. Una baja de Clerk deja la fila con `eliminado_en` y sin email/nombre (CHECK).
export const shopClientes = shop.table("clientes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id").notNull(),
  clerkUserId: text("clerk_user_id").notNull(),
  email: text("email"),
  emailNorm: text("email_norm"),
  nombre: text("nombre"),
  creadoEnClerk: timestamp("creado_en_clerk", { withTimezone: true }),
  actualizadoEnClerk: timestamp("actualizado_en_clerk", { withTimezone: true }).notNull(),
  eliminadoEn: timestamp("eliminado_en", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

// Vínculo usuario de la tienda ↔ contacto de Alegra (0000/0014 del Shop). SIN tenant_id: el
// tenant sale de `shopClientes` (mismo clerk_user_id). Nunca se borra: 'activa' | 'revocada' |
// 'sin_coincidencia' ('sin_coincidencia' guarda alegra_contact_id '' o 'ambiguo').
export const shopClientLinks = shop.table("client_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull(),
  alegraContactId: text("alegra_contact_id").notNull(),
  razonSocial: text("razon_social"),
  cuit: text("cuit"),
  idPriceList: text("id_price_list"),
  tipoCuenta: text("tipo_cuenta"), // 'corriente' | 'contado'
  estado: text("estado").notNull().default("activa"),
  // 'email_verificado' | 'otp_email' | 'cookie_crm' | 'operador'
  metodo: text("metodo").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
})

export type ShopClienteRow = typeof shopClientes.$inferSelect
export type ShopClientLinkRow = typeof shopClientLinks.$inferSelect
