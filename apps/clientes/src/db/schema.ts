import {
  pgSchema,
  check,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  smallint,
  numeric,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PlanDeCuotas, PlanPedido } from "../lib/pagos/cuotas-tipos";

/**
 * Todas las tablas del Shop viven en el esquema `shop` de la base del CRM.
 *
 * Una sola base, dos dueños de datos: el CRM ocupa `public` y el Shop ocupa
 * `shop`. Declararlo con `pgSchema` (y no con un `search_path` del rol) hace que
 * drizzle califique cada tabla (`"shop"."orders"`) en todo el SQL que genera:
 * nada depende de cómo esté configurada la conexión, que detrás del pooler ni
 * siquiera garantiza los settings a nivel rol.
 *
 * Las migraciones llevan su propio control en `shop.__drizzle_migrations` (ver
 * drizzle.config.ts y src/db/migrate.ts), separado del `drizzle.*` del CRM.
 */
export const shop = pgSchema("shop");

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
 */

export const catalogCategories = shop.table(
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

export const catalogProducts = shop.table(
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
    /**
     * Alícuota de IVA del ítem (21.00, 10.50, 0.00…), para exhibir precio final
     * y "precio sin impuestos nacionales". null = Alegra no mandó `tax` o el
     * producto todavía no pasó por una sync: se muestra el precio como antes.
     * Nunca se completa con el default de la cotización (ver `ivaPersistible`).
     */
    ivaPorcentaje: numeric("iva_porcentaje", { precision: 5, scale: 2 }),
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

/**
 * Vinculación entre una cuenta de acceso (Clerk) y un cliente de Alegra.
 *
 * Son dos identidades distintas y no se corresponden 1 a 1:
 * - Clerk responde "quién está navegando" (una persona con un email de Google).
 * - Alegra responde "qué cliente es" (un CUIT, con su lista de precios y su
 *   cuenta corriente).
 *
 * Una empresa puede tener tres empleados comprando, cada uno con su Google, y
 * los tres apuntando al mismo `alegraContactId`. Y alguien puede comprar sin
 * ninguna vinculación: es consumidor final y ve la lista general.
 *
 * Los datos del cliente quedan como SNAPSHOT para no pegarle a Alegra en cada
 * request. La lista de precios sí se re-lee al cotizar — ver src/lib/auth.ts.
 */
export const clientLinks = shop.table(
  "client_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    /** Id del contacto en Alegra = `codigocliente` en la sesión vieja del CRM. */
    alegraContactId: text("alegra_contact_id").notNull(),
    razonSocial: text("razon_social"),
    cuit: text("cuit"),
    idPriceList: text("id_price_list"),
    tipoCuenta: text("tipo_cuenta"), // 'corriente' | 'contado'
    /**
     * 'activa' | 'revocada' | 'sin_coincidencia'.
     *
     * Nunca se borra: la revocación es auditable. `sin_coincidencia` no es un
     * vínculo — es la marca de "ya buscamos el email de este usuario en Alegra
     * y no había nada", para no repetir esa consulta en cada visita.
     */
    estado: text("estado").notNull().default("activa"),
    /**
     * Cómo se probó la identidad:
     * - `email_verificado`: el email con el que entró (verificado por Clerk) ya
     *   figura en el contacto de Alegra. Es la misma prueba que el OTP —
     *   controlar esa casilla — pero ya la hizo Clerk al autenticar.
     * - `otp_email`: código a la casilla registrada. Para quien entra con un
     *   mail distinto al que tiene cargado el sistema.
     * - `cookie_crm` | `operador`.
     */
    metodo: text("metodo").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    // Un usuario puede tener UNA sola vinculación activa, pero sí varias
    // revocadas en el historial. De ahí el índice parcial: un unique común
    // impediría re-vincular después de una revocación.
    uniqueIndex("cl_user_activa")
      .on(t.clerkUserId)
      .where(sql`${t.estado} = 'activa'`),
    index("cl_contacto").on(t.alegraContactId),
  ],
);

/**
 * Datos de facturación del comprador.
 *
 * Ojo con la confusión fácil: el CUIT de acá NO es el mismo concepto que el
 * CUIT de `client_links`, aunque sea el mismo número.
 *
 * - Acá es **un dato de la factura**: "emitíme el comprobante a este CUIT". Lo
 *   carga el cliente y es editable, porque sin esto no se le puede facturar a
 *   nadie. No otorga absolutamente nada.
 * - En `client_links` es **un reclamo de identidad**: "yo SOY ese cliente de
 *   Alegra, dame su lista de precios y su cuenta corriente". Eso se prueba con
 *   OTP y nunca se tipea.
 *
 * Cuando el usuario vincula, Alegra pasa a ser la fuente de verdad y este
 * perfil queda de solo lectura: los datos ya no son "lo que el cliente dice"
 * sino "lo que factura el sistema".
 */
export const billingProfiles = shop.table(
  "billing_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),

    /**
     * 'AR' | 'BR' | 'PY'. País del documento: define qué documentos se aceptan
     * y cómo se validan, y si se ofrece envío (solo Argentina). El domicilio
     * fiscal NO depende de esto.
     */
    pais: text("pais").notNull().default("AR"),
    /** AR: 'CUIT' | 'DNI'. BR: 'CNPJ' | 'CPF'. PY: 'RUC' | 'CI'. */
    tipoDoc: text("tipo_doc").notNull(),
    /** Sin guiones ni puntos: se normaliza al guardar. Solo el CNPJ trae letras. */
    nroDoc: text("nro_doc").notNull(),
    /** Razón social, o nombre y apellido si es consumidor final. */
    razonSocial: text("razon_social").notNull(),
    /** 'consumidor_final' | 'monotributo' | 'responsable_inscripto'. */
    condicionIva: text("condicion_iva").notNull(),

    // --- Domicilio fiscal (el de la factura, no el de entrega) ---
    domicilioCalle: text("domicilio_calle"),
    domicilioCiudad: text("domicilio_ciudad"),
    domicilioProvincia: text("domicilio_provincia"),
    domicilioCp: text("domicilio_cp"),

    /**
     * Teléfono de contacto para el pedido. Se guarda como lo escribió el
     * cliente (con "+", espacios o guiones) y el checkout lo precarga: sin esto
     * había que tipearlo en cada compra. Opcional en el perfil; el pedido lo
     * sigue exigiendo y, si el perfil no lo tenía, lo aprende de ahí.
     */
    telefono: text("telefono"),

    /**
     * Se detectó que este documento ya existe como contacto en Alegra. NO
     * vincula nada: solo habilita el aviso "parece que ya sos cliente" y marca
     * el pedido para que un operador lo mire antes de facturar. Vincular solo
     * por coincidencia de CUIT sería exactamente el agujero que tapa el OTP.
     */
    coincideConAlegra: text("coincide_con_alegra"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bp_user").on(t.clerkUserId),
    index("bp_doc").on(t.nroDoc),
  ],
);

/**
 * Códigos de un solo uso para probar que una cuenta corriente es tuya.
 *
 * Dos reglas que hacen que esto valga algo, y que el OTP del CRM no cumple:
 *
 * 1. El código se manda al email que YA está cargado en Alegra, nunca a uno que
 *    el usuario escriba. Si vuelve al que lo pidió, no prueba nada.
 * 2. Acá se guarda un HASH, no el código. Quien lea la base no puede usarlo.
 *
 * El CUIT no alcanza como prueba: en Argentina es público — está en cada
 * factura y en el padrón de AFIP.
 */
export const linkOtps = shop.table(
  "link_otps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    alegraContactId: text("alegra_contact_id").notNull(),
    /** SHA-256 del código. El código en claro solo existe en el email. */
    codeHash: text("code_hash").notNull(),
    /** Destino enmascarado (j***@empresa.com) para poder mostrarlo sin filtrarlo. */
    destinoMasked: text("destino_masked").notNull(),
    intentos: integer("intentos").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("lo_user").on(t.clerkUserId, t.createdAt),
    index("lo_expira").on(t.expiresAt),
  ],
);

/**
 * Pedidos armados desde el shop.
 *
 * El pedido es el ÚNICO concepto del que el Shop es dueño: Alegra no se entera
 * hasta que un operador factura a mano. Por eso vive entero acá y no se replica.
 *
 * Todo lo que se le prometió al cliente queda CONGELADO en la fila: razón
 * social, precios, IVA, totales. Si mañana cambia el precio en Alegra o el
 * cliente cambia de lista, un pedido histórico no puede mutar — es el registro
 * de lo que se acordó, no una vista del catálogo actual.
 */
export const orders = shop.table(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Número correlativo visible al cliente (se muestra como PED-00001000).
     * Identity y no un contador en app: dos checkouts simultáneos con un
     * `max(numero) + 1` se pisan, la secuencia de Postgres no.
     */
    numero: integer("numero").generatedAlwaysAsIdentity({ startWith: 1000 }).notNull(),

    /**
     * Tenant dueño del pedido (slug de `public.tenants.id` del CRM).
     *
     * Obligatorio y sin default a propósito: la base es compartida con el CRM,
     * que lista los pedidos por tenant; un pedido sin tenant sería invisible
     * para todos, y un default lo asignaría en silencio al tenant equivocado.
     * Sin FK: es otro esquema, y el rol de runtime del Shop no tiene REFERENCES
     * sobre `public`.
     */
    tenantId: text("tenant_id").notNull(),

    // --- Cliente (snapshot de la sesión al momento de comprar) ---
    /**
     * Quién compró, del lado del acceso. Es el ancla del pedido: siempre está,
     * incluso cuando el comprador no tiene cuenta corriente.
     */
    clerkUserId: text("clerk_user_id"),
    /**
     * Id del contacto en Alegra. NULL = consumidor final: alguien logueado que
     * compró sin vincular cuenta corriente, a lista general. Por eso no es
     * `notNull`: exigirlo obligaría a inventar un contacto falso en Alegra para
     * cada visitante, que es exactamente lo que no queremos.
     */
    clienteCodigo: text("cliente_codigo"),
    clienteRazonSocial: text("cliente_razon_social"),
    clienteCuit: text("cliente_cuit"),
    clienteEmail: text("cliente_email"),
    /** Lista de precios con la que se cotizó. null = lista principal. */
    idPriceList: text("id_price_list"),

    // --- Contacto para este pedido (puede diferir del titular de la cuenta) ---
    contactoNombre: text("contacto_nombre").notNull(),
    contactoTelefono: text("contacto_telefono").notNull(),

    // --- Entrega ---
    entregaTipo: text("entrega_tipo").notNull(), // 'retiro' | 'envio'
    entregaCiudad: text("entrega_ciudad"),
    entregaDireccion: text("entrega_direccion"),

    // --- Facturación (copia congelada del perfil al momento de comprar) ---
    //
    // Se copia en vez de referenciar `billing_profiles`: si el cliente después
    // corrige su razón social o se muda, una factura ya emitida no puede
    // cambiar retroactivamente. El pedido es el registro de lo que se acordó.
    facturacionTipoDoc: text("facturacion_tipo_doc"),
    facturacionNroDoc: text("facturacion_nro_doc"),
    facturacionRazonSocial: text("facturacion_razon_social"),
    facturacionCondicionIva: text("facturacion_condicion_iva"),
    facturacionDomicilio: text("facturacion_domicilio"),
    /**
     * El documento de facturación coincide con un contacto de Alegra que el
     * comprador NO tiene vinculado. Un operador debe revisar antes de facturar,
     * para no terminar con dos clientes duplicados para el mismo CUIT.
     */
    requiereRevision: boolean("requiere_revision").notNull().default(false),

    // --- Pago ---
    pagoMetodo: text("pago_metodo").notNull(), // 'transferencia' | 'efectivo' | 'cuenta_corriente' | 'mercadopago'
    /**
     * 'pendiente' | 'pagado' | 'fallido'.
     *
     * Para los métodos offline lo mueve un operador. Para los online lo mueve
     * el webhook del proveedor, que es la ÚNICA fuente de verdad: la URL de
     * retorno del comprador se puede escribir a mano en la barra del navegador.
     */
    pagoEstado: text("pago_estado").notNull().default("pendiente"),

    /** 'mercadopago' | 'mobbex' | 'modo'. null = pago offline. */
    pagoProveedor: text("pago_proveedor"),
    /**
     * Id del pago en el proveedor. Único: es lo que hace idempotente al webhook,
     * que MP reintenta y puede mandar repetido.
     */
    pagoReferencia: text("pago_referencia"),
    /** 'tarjeta' | 'cuenta_mp'. Para poder mirar el mix de medios después. */
    pagoMedio: text("pago_medio"),
    /**
     * `status_detail` crudo del proveedor. Se guarda sin traducir a propósito:
     * cuando un cliente llama porque "no le anda la tarjeta", el motivo real es
     * lo único que permite ayudarlo. El mensaje que ve él es una traducción de
     * esto, no el dato.
     */
    pagoDetalle: text("pago_detalle"),
    pagoActualizadoEn: timestamp("pago_actualizado_en", { withTimezone: true }),

    // --- Estado del pedido ---
    estado: text("estado").notNull().default("pendiente"),
    /**
     * Motivo de la cancelación. Obligatorio cuando `estado = 'cancelado'` (lo
     * garantiza `orders_cancelacion_motivo_check`, para los DOS escritores: el
     * CRM y el propio Shop). Es un dato INTERNO: no se mapea nunca a lo que ve
     * el cliente. No se reutiliza `notas`, que es la aclaración que escribió el
     * comprador y que se le muestra de vuelta en Mis compras.
     */
    cancelacionMotivo: text("cancelacion_motivo"),
    /**
     * Auditoría del último cambio de estado. Todo null en un pedido recién
     * creado. `estadoActualizadoPor` es el id del operador del CRM
     * (`admin_users.id`), sin FK por ser otro esquema; queda null cuando el
     * cambio lo hace el propio cliente. El nombre se guarda como snapshot
     * para poder mostrar quién fue aunque el usuario se renombre o se borre.
     */
    estadoActualizadoEn: timestamp("estado_actualizado_en", { withTimezone: true }),
    estadoActualizadoPor: uuid("estado_actualizado_por"),
    estadoActualizadoPorNombre: text("estado_actualizado_por_nombre"),

    // --- Totales congelados ---
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
    iva: numeric("iva", { precision: 14, scale: 2 }).notNull(),
    costoEnvio: numeric("costo_envio", { precision: 14, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),

    notas: text("notas"),

    /**
     * Clave que manda el checkout para que un reintento no cree un pedido de más.
     *
     * El caso que resuelve no es el doble clic (eso lo tapa el botón
     * deshabilitado), sino el peor: el POST llega, el pedido se crea, y la
     * respuesta se pierde en el camino. El cliente ve "no pudimos conectarnos",
     * reintenta, y termina con dos pedidos por una sola compra. Con pago online
     * eso sería un cobro doble.
     *
     * Nullable porque los pedidos anteriores a esta columna no la tienen, y
     * porque un pedido cargado a mano por un operador tampoco necesita una.
     */
    idempotencyKey: text("idempotency_key"),

    // --- Cuotas (cambio cuotas-configurables) ---
    /**
     * Máximo de cuotas congelado al crear el pedido, calculado en el server sobre
     * el total real. null = pedido anterior al cambio o sin oferta leíble al
     * crearlo ⇒ la ruta de pago aplica el comportamiento legacy (clamp 1..24).
     */
    cuotasMax: integer("cuotas_max"),
    /**
     * Snapshot `PlanPedido` (proveedor, máximo, opciones, versión de config).
     * Auditoría: la ruta de pago sólo lee `cuotas_max`. Pedidos anteriores a
     * cuotas v2 pueden traer el shape v1 (con `maxPorMedio`).
     */
    cuotasPlan: jsonb("cuotas_plan").$type<PlanPedido>(),
    /** Cuotas reales que informó el proveedor al confirmar el pago. */
    pagoCuotas: integer("pago_cuotas"),
    /** Total pagado real (con interés) según el proveedor. `total` no cambia. */
    pagoTotalPagado: numeric("pago_total_pagado", { precision: 14, scale: 2 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_numero").on(t.numero),
    // Parcial: los pedidos sin clave (históricos, o cargados por un operador) no
    // deben chocar entre sí por tener todos NULL.
    uniqueIndex("orders_idempotency")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    // Misma lógica de índice parcial: hace idempotente al webhook sin que los
    // pedidos offline (todos con referencia NULL) choquen entre sí.
    uniqueIndex("orders_pago_referencia")
      .on(t.pagoReferencia)
      .where(sql`${t.pagoReferencia} is not null`),
    index("orders_cliente_fecha").on(t.clienteCodigo, t.createdAt),
    // "Mis pedidos" busca por quien compró, no por la cuenta corriente: si
    // alguien compra sin vincular y vincula después, sus pedidos siguen siendo
    // suyos.
    index("orders_clerk_fecha").on(t.clerkUserId, t.createdAt),
    index("orders_estado").on(t.estado),
    // El listado de pedidos del CRM: siempre por tenant, del más nuevo al más viejo.
    index("orders_tenant_fecha").on(t.tenantId, t.createdAt),
    // Los 6 valores de `OrderEstado` (src/data/orders.ts). En la base y no solo
    // en el tipo porque ahora escriben dos apps sobre la misma tabla.
    check(
      "orders_estado_check",
      sql`${t.estado} in ('pendiente','confirmado','preparacion','en_camino','entregado','cancelado')`,
    ),
    // Cancelado ⇒ motivo. Vale para el CRM y para el Shop por igual.
    check(
      "orders_cancelacion_motivo_check",
      sql`${t.estado} <> 'cancelado' or ${t.cancelacionMotivo} is not null`,
    ),
  ],
);

/**
 * Líneas del pedido. Snapshot puro: no hay FK viva a `catalog_products` a
 * propósito — se guarda el `alegraItemId` como referencia informativa, pero el
 * nombre y el precio que se muestran salen de acá, no de un join.
 */
export const orderItems = shop.table(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Id del ítem en Alegra. Referencia, no FK: el ítem puede desaparecer. */
    alegraItemId: text("alegra_item_id").notNull(),
    code: text("code"),
    name: text("name").notNull(),
    brand: text("brand"),
    qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
    /** Precio unitario SIN IVA, ya resuelto contra la lista del cliente. */
    precioUnitario: numeric("precio_unitario", { precision: 14, scale: 2 }).notNull(),
    /** Alícuota aplicada (21.00, 10.50, 0.00…). Sale del `tax` del ítem. */
    ivaPorcentaje: numeric("iva_porcentaje", { precision: 5, scale: 2 }).notNull(),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
    iva: numeric("iva", { precision: 14, scale: 2 }).notNull(),
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [index("order_items_order").on(t.orderId)],
);

/** Bitácora de cada corrida de sync: observabilidad y "última sincronización". */
export const catalogSyncLog = shop.table(
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

/**
 * Última copia BUENA de los planes de cuotas de un proveedor para un medio
 * (tasas reales, CFT, TEA). Se reemplaza sólo si la respuesta es válida: un
 * fallo deja `planes` y `fetchedAt` como estaban y anota `lastError`.
 */
export const paymentPlanSnapshots = shop.table(
  "payment_plan_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proveedor: text("proveedor").notNull(), // 'mercadopago'
    medio: text("medio").notNull(), // 'visa' | 'master'
    planes: jsonb("planes").$type<PlanDeCuotas[]>().notNull().default([]),
    /** null = nunca hubo una copia buena. */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    /** Lock optimista: evita dos sync simultáneas (cron + lazy). */
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => [uniqueIndex("pps_proveedor_medio").on(t.proveedor, t.medio)],
);

/**
 * Caché de la configuración de cuotas del CRM (contrato v2) por tenant. Un
 * payload válido sin proveedores se guarda igual: vacío válido no es un fallo.
 */
export const paymentConfigCache = shop.table("payment_config_cache", {
  tenant: text("tenant").primaryKey(), // SHOP_TENANT_ID
  payload: jsonb("payload"),
  version: text("version"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastError: text("last_error"),
});

/** Contenido administrable de la home. Una fila por sección; el CRM escribe vía
 *  PUT /api/internal/home-content y la home la mergea con defaults en código. */
export const homeContent = shop.table("home_content", {
  key: text("key").primaryKey(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Catálogo comercial administrado desde el CRM (contrato catalogo-overlay/v1) ───
//
// Espejo, no fuente: el CRM manda. El Shop copia una vez por día (o cuando el CRM avisa) y
// después lee SIEMPRE de acá, así una caída del CRM no afecta a la tienda.
// Mono-tenant como el resto del Shop; los ids son los del CRM y se conservan tal cual.

/** Taxonomía propia. Viaja entera y se reemplaza de una: no hay merge parcial. */
export const shopCategories = shop.table(
  "shop_categories",
  {
    id: uuid("id").primaryKey(),
    parentId: uuid("parent_id"),
    nombre: text("nombre").notNull(),
    slug: text("slug").notNull(),
    orden: integer("orden").notNull().default(0),
    nivel: smallint("nivel").notNull().default(1),
    activa: boolean("activa").notNull().default(true),
    /** URL completa, ya compuesta por el CRM. El Shop no conoce su layout de keys. */
    imagen: text("imagen"),
  },
  (t) => [index("shop_categories_parent_idx").on(t.parentId, t.orden), index("shop_categories_slug_idx").on(t.slug)],
);

export const shopTags = shop.table(
  "shop_tags",
  {
    id: uuid("id").primaryKey(),
    nombre: text("nombre").notNull(),
    slug: text("slug").notNull(),
  },
  (t) => [index("shop_tags_slug_idx").on(t.slug)],
);

export interface FotoOverlay {
  url: string;
  w: number;
  alt?: string;
}

/**
 * Overlay por producto. ESPARSO: sólo hay fila para los que alguien tocó en el CRM.
 * Sin fila, el producto no se publica — `visible` arranca en false y nada sale solo.
 */
export const catalogOverlay = shop.table(
  "catalog_overlay",
  {
    alegraId: text("alegra_id").primaryKey(),
    visible: boolean("visible").notNull().default(false),
    nombre: text("nombre"),
    descripcion: text("descripcion"),
    categoriaId: uuid("categoria_id"),
    orden: integer("orden"),
    tagIds: uuid("tag_ids").array().notNull().default(sql`'{}'`),
    fotos: jsonb("fotos").$type<FotoOverlay[]>().notNull().default([]),
    /** El del CRM, con MICROSEGUNDOS: es el cursor del delta y no puede truncarse. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("catalog_overlay_visible_idx").on(t.visible),
    index("catalog_overlay_categoria_idx").on(t.categoriaId),
  ],
);

/** Estado de la sync. Una fila. Última copia buena: un fallo no borra lo ya copiado. */
export const catalogoSyncState = shop.table("catalogo_sync_state", {
  tenant: text("tenant").primaryKey(), // SHOP_TENANT_ID
  cursorUpdatedAt: text("cursor_updated_at"),
  cursorAlegraId: text("cursor_alegra_id"),
  taxonomiaFetchedAt: timestamp("taxonomia_fetched_at", { withTimezone: true }),
  overlayFetchedAt: timestamp("overlay_fetched_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastError: text("last_error"),
});
