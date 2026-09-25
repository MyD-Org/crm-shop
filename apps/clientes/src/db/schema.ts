import {
  pgSchema,
  check,
  uuid,
  text,
  jsonb,
  timestamp,
  date,
  integer,
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

/*
 * El catálogo NO vive en este esquema: el Shop lo lee de las vistas del CRM
 * (`public.catalog_products_shop` / `public.catalog_categories_shop`, ver
 * src/db/crm.ts). Las tablas del espejo propio (catalog_products,
 * catalog_categories y catalog_sync_log de este esquema) se dropearon en 0015.
 */

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
    // Un cliente de Alegra sí puede tener varios usuarios activos (la misma
    // persona con dos emails, varias personas de una empresa): cada uno pasó
    // por el código al email de Alegra. `cl_contacto_activa` se borró en 0014.
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
    /**
     * AR: 'CUIT' | 'DNI' (| 'CUIL', deducido del espejo). BR: 'CNPJ' | 'CPF'.
     * PY: 'RUC' | 'CI'.
     *
     * Documento, razón social y condición admiten NULL desde la 0009: un
     * comprador vinculado a Alegra (cuyos datos de facturación salen del espejo
     * del CRM) puede tener una fila "sólo teléfono". Una fila así nunca cuenta
     * como perfil completo (`perfilCompleto`).
     */
    tipoDoc: text("tipo_doc"),
    /** Sin guiones ni puntos: se normaliza al guardar. Solo el CNPJ trae letras. */
    nroDoc: text("nro_doc"),
    /** Razón social, o nombre y apellido si es consumidor final. */
    razonSocial: text("razon_social"),
    /** 'consumidor_final' | 'monotributo' | 'responsable_inscripto' | 'exento'. */
    condicionIva: text("condicion_iva"),

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
     * Un operador debe revisar el pedido antes de facturar. El porqué va en
     * `motivoRevision`.
     */
    requiereRevision: boolean("requiere_revision").notNull().default(false),
    /**
     * Por qué requiere revisión (0010): 'documento_incompatible' |
     * 'condicion_iva_desconocida' | 'facturacion_en_pedido' |
     * 'otra_lista_precios' (ver `src/lib/motivo-revision.ts`). Sin CHECK a
     * propósito: sumar un motivo no pide migración. NULL en pedidos anteriores
     * a la 0010 y en los que no requieren revisión. Lo lee el CRM.
     */
    motivoRevision: text("motivo_revision"),

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

    /**
     * Quién registró (o anuló) el último pago OFFLINE desde el CRM: operador y su nombre al
     * momento, sin FK (mismo patrón que `estadoActualizado*`). NULL en los pagos online, que
     * mueve el webhook del proveedor, y en los pedidos anteriores a la 0017.
     */
    pagoRegistradoPor: uuid("pago_registrado_por"),
    pagoRegistradoPorNombre: text("pago_registrado_por_nombre"),

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
    /**
     * Pago que un operador tiene que revisar, o null si está todo en orden:
     * - `cobro_duplicado`: más de un intento aprobado; hay que devolver el
     *   excedente.
     * - `pagado_cancelado`: se aprobó un pago de un pedido ya cancelado; hay que
     *   devolverlo o reactivar el pedido.
     * Lo recalcula `registrarCobro` en cada evento: al procesarse la devolución
     * en Mercado Pago, la marca se va sola. Lo lee el CRM.
     */
    pagoRevision: text("pago_revision"),

    // --- Facturado en Alegra (migración 0011) ---
    /**
     * Cuándo un operador del CRM marcó el pedido como ya facturado en Alegra, y
     * quién. Independiente de `estado`: un pedido `en_camino` puede estar
     * facturado o no. Lo escribe el CRM ("Marcar como facturado"); el Shop sólo
     * lo lee a través de `shop.stock_reservado`: un pedido facturado deja de
     * reservar stock, porque desde ese momento la factura ya lo descontó en
     * Alegra. Mismo patrón de auditoría que `estadoActualizado*` (sin FK: el
     * operador vive en `public`).
     */
    facturadoEn: timestamp("facturado_en", { withTimezone: true }),
    facturadoPor: uuid("facturado_por"),
    facturadoPorNombre: text("facturado_por_nombre"),
    // --- Factura de Alegra vinculada (migración 0013) ---
    /**
     * La factura de Alegra que un operador del CRM vinculó al pedido ("Vincular
     * factura": la hizo por fuera y la busca por número). Al vincularla el CRM
     * también completa `facturado*` (libera la reserva); al desvincularla borra
     * las siete columnas juntas. Número, fecha y total son una copia de lo que
     * Alegra devolvió en ese momento, para mostrarla sin volver a consultarla.
     * Las escribe SÓLO el CRM; el Shop hoy no las lee.
     */
    facturaAlegraId: text("factura_alegra_id"),
    facturaNumero: text("factura_numero"),
    facturaFecha: date("factura_fecha", { mode: "string" }),
    facturaTotal: numeric("factura_total", { precision: 14, scale: 2 }),

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
    // Los pedidos que pueden estar reservando stock (ver `stockReservado`): la
    // vista los filtra con este mismo predicado, así que Postgres recorre sólo
    // los vivos y no el histórico entero.
    index("orders_reserva_activa")
      .on(t.tenantId, t.createdAt)
      .where(
        sql`${t.facturadoEn} is null and ${t.estado} in ('pendiente','confirmado','preparacion','en_camino')`,
      ),
    // Los 6 valores de `OrderEstado` (src/data/orders.ts). En la base y no solo
    // en el tipo porque ahora escriben dos apps sobre la misma tabla.
    check(
      "orders_estado_check",
      sql`${t.estado} in ('pendiente','confirmado','preparacion','en_camino','entregado','cancelado')`,
    ),
    check(
      "orders_pago_revision_check",
      sql`${t.pagoRevision} is null or ${t.pagoRevision} in ('cobro_duplicado','pagado_cancelado')`,
    ),
    // Cancelado ⇒ motivo. Vale para el CRM y para el Shop por igual.
    check(
      "orders_cancelacion_motivo_check",
      sql`${t.estado} <> 'cancelado' or ${t.cancelacionMotivo} is not null`,
    ),
    // Factura vinculada ⇒ facturado (0013). Vincular y desvincular escriben las
    // columnas juntas en un mismo UPDATE; esto es la última red.
    check(
      "orders_factura_facturado_check",
      sql`${t.facturaAlegraId} is null or ${t.facturadoEn} is not null`,
    ),
  ],
);

/**
 * Líneas del pedido. Snapshot puro: no hay FK viva al catálogo a
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

/**
 * Unidades reservadas por ítem (vista `shop.stock_reservado`, migración 0012).
 *
 * Suma de `qty` de las líneas de los pedidos del Shop que todavía apartan
 * stock: no facturados y en `confirmado`, `preparacion` o `en_camino`, o
 * `pendiente` con menos de 24 h desde su creación (la misma ventana que
 * `VENTANA_PAGO_MS`) o ya pagado online. Cancelar, entregar, marcar facturado o
 * dejar vencer un pendiente libera la reserva sin escribir nada: se calcula al
 * leer. El disponible que ve y valida el Shop es `stock − qty` (ver
 * `src/lib/stock-disponible.ts`); el espejo del stock nunca se toca.
 *
 * `.existing()`: la vista la crea la migración 0012 a mano (drizzle-kit no la
 * genera ni la compara).
 */
export const stockReservado = shop
  .view("stock_reservado", {
    tenantId: text("tenant_id").notNull(),
    alegraItemId: text("alegra_item_id").notNull(),
    qty: numeric("qty").notNull(),
  })
  .existing();

/**
 * Un intento de cobro por fila. Un pedido puede tener varios: el comprador
 * reintenta con otra tarjeta, abandona un 3DS, etc.
 *
 * Existe porque `orders.pago_referencia` guarda UNA sola referencia y cada
 * intento la pisaba: si el primer pago quedaba pendiente y se aprobaba después
 * del segundo intento, el webhook ya no lo reconocía y la plata cobrada no
 * llegaba al pedido. Las columnas `pago_*` de `orders` siguen existiendo como
 * RESUMEN (las lee el CRM); la verdad de cada intento vive acá.
 *
 * `referencia` es null mientras el intento está reservado y todavía no volvió
 * la respuesta del proveedor.
 */
export const pagoIntentos = shop.table(
  "pago_intentos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    proveedor: text("proveedor").notNull(),
    /** Id del pago en el proveedor. null = reservado, sin respuesta todavía. */
    referencia: text("referencia"),
    /** 'pendiente' | 'pagado' | 'fallido', igual que `orders.pago_estado`. */
    estado: text("estado").notNull().default("pendiente"),
    detalle: text("detalle"),
    medio: text("medio"),
    cuotas: integer("cuotas"),
    totalPagado: numeric("total_pagado", { precision: 14, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotencia del webhook: el mismo pago nunca genera dos filas.
    uniqueIndex("pago_intentos_referencia")
      .on(t.proveedor, t.referencia)
      .where(sql`${t.referencia} is not null`),
    // "Un solo intento abierto por pedido" NO va como índice único: el webhook
    // puede recuperar un intento viejo que sigue pendiente, y ese insert
    // chocaría. La exclusión la da `reservarIntento`, que bloquea la fila del
    // pedido antes de mirar los intentos abiertos.
    index("pago_intentos_order").on(t.orderId),
    index("pago_intentos_tenant_estado").on(t.tenantId, t.estado),
    check(
      "pago_intentos_estado_check",
      sql`${t.estado} in ('pendiente','pagado','fallido')`,
    ),
  ],
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

/** Contenido administrable de la home. Una fila por sección; la escriben las
 *  server actions de src/lib/home-acciones.ts (usuario admin) y la home la
 *  mergea con defaults en código. navBadge apagado = jsonb 'null'. */
export const homeContent = shop.table("home_content", {
  key: text("key").primaryKey(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Favoritos de Mi cuenta: qué productos guardó cada usuario de Clerk.
 *
 * - `tenant_id` obligatorio y sin default, por la misma razón que en `orders`:
 *   la base es compartida y toda lectura/escritura filtra por el tenant del
 *   entorno (`shopTenantId()`, ver src/lib/favoritos.ts).
 * - El ancla es `clerk_user_id`, como en `billing_profiles`: un visitante con la
 *   cookie del CRM y sin Clerk no tiene dónde guardar favoritos.
 * - Sin FK al catálogo (vive en el CRM, `catalog_products_shop`): un ítem puede
 *   desaparecer; el favorito queda y la lista simplemente lo omite.
 * - El unique por (tenant, usuario, ítem) hace idempotente el alta
 *   (`on conflict do nothing`); el índice por fecha sirve al "más nuevo primero".
 */
export const favorites = shop.table(
  "favorites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    /** Id del ítem en Alegra (el mismo que usa `/producto/[id]`). */
    alegraItemId: text("alegra_item_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fav_tenant_usuario_item").on(t.tenantId, t.clerkUserId, t.alegraItemId),
    index("fav_tenant_usuario_fecha").on(t.tenantId, t.clerkUserId, t.createdAt),
  ],
);

/**
 * Direcciones de envío guardadas en Mi cuenta (migración `0003`).
 *
 * Por usuario de Clerk y tenant, como `favorites`: toda consulta filtra por los
 * dos (`src/lib/direcciones-envio-db.ts`). Hasta 10 por usuario (lo controla el
 * código) y exactamente UNA predeterminada: el índice único PARCIAL lo
 * garantiza en la base, así que marcar otra obliga a desmarcar primero (en la
 * misma transacción). `provincia` y `cp` quedan nullable en la base aunque la
 * API los exige: la regla vive en `src/lib/direcciones-envio.ts`.
 * Cualquier localidad del país es válida; la zona de envío la decide
 * `src/lib/envio.ts` al usarla, no al guardarla.
 */
export const direccionesEnvio = shop.table(
  "direcciones_envio",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    /** Nombre corto opcional ("Casa", "Obra"). */
    etiqueta: text("etiqueta"),
    calle: text("calle").notNull(),
    ciudad: text("ciudad").notNull(),
    provincia: text("provincia"),
    cp: text("cp"),
    /** Indicaciones para quien entrega. */
    referencias: text("referencias"),
    predeterminada: boolean("predeterminada").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dir_envio_tenant_usuario").on(t.tenantId, t.clerkUserId),
    uniqueIndex("dir_envio_una_predeterminada")
      .on(t.tenantId, t.clerkUserId)
      .where(sql`${t.predeterminada}`),
  ],
);

/**
 * Carrito del usuario de Clerk (migración `0008`), para que lo siga entre
 * dispositivos.
 *
 * - UNA fila por (tenant, usuario): el unique la garantiza y hace posible el
 *   `on conflict do nothing` del primer guardado y del merge.
 * - `items` guarda sólo `{ id, qty }` (id de Alegra y cantidad) en el orden del
 *   carrito: nombre, marca y precio envejecen, se toman del espejo al leer
 *   (`src/lib/carrito-db.ts`). Sin FK al catálogo, como `favorites`.
 * - `version` es monotónica: cada escritura la sube en 1 y el PUT sólo aplica
 *   si el cliente trae la vigente (concurrencia optimista entre dispositivos).
 *   Crear un pedido VACÍA la fila (items `[]`, version + 1) en vez de borrarla,
 *   para que un dispositivo con una versión vieja reciba conflicto.
 * - Un visitante con la cookie del CRM sin Clerk no tiene carrito en la base.
 */
export const carts = shop.table(
  "carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    items: jsonb("items").$type<{ id: string; qty: number }[]>().notNull().default([]),
    version: integer("version").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cart_tenant_usuario").on(t.tenantId, t.clerkUserId),
    check("carts_version_check", sql`${t.version} >= 0`),
  ],
);

/**
 * Solicitudes del Botón de arrepentimiento (`/arrepentimiento`, migración
 * `0016`). Res. 424/2020: el consumidor revoca la compra desde el sitio y
 * recibe un código en pantalla (ARR-000001, del `numero`).
 *
 * - Datos personales MÍNIMOS: los que tipea la persona. Sin IP ni user agent
 *   (el anti-spam por IP vive en memoria, `src/lib/rate-limit.ts`).
 * - El email se guarda ya normalizado (trim + minúsculas, lo hace la app): el
 *   tope por email del índice `sa_tenant_email_fecha` compara igualdad simple.
 * - `email_*`: resultado de los avisos (cliente y comercio). Un mail que no sale
 *   no invalida la solicitud: la fila se guarda antes de enviar.
 * - Los topes de largo están también en la base (`sa_largos`): el form es
 *   público, sin sesión.
 */
export const solicitudesArrepentimiento = shop.table(
  "solicitudes_arrepentimiento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Correlativo del código visible (ARR-000001). Identity, como `orders.numero`. */
    numero: integer("numero").generatedAlwaysAsIdentity().notNull(),
    /**
     * Tenant de la tienda (slug de `public.tenants.id`). Obligatorio y sin
     * default, por lo mismo que `orders.tenant_id`: un default lo asignaría en
     * silencio al tenant equivocado.
     */
    tenantId: text("tenant_id").notNull(),
    nombre: text("nombre").notNull(),
    email: text("email").notNull(),
    telefono: text("telefono").notNull(),
    /** Texto libre: la persona puede no tener el número a mano. */
    pedidoNumero: text("pedido_numero"),
    motivo: text("motivo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    emailClienteEnviadoEn: timestamp("email_cliente_enviado_en", { withTimezone: true }),
    emailComercioEnviadoEn: timestamp("email_comercio_enviado_en", { withTimezone: true }),
    emailError: text("email_error"),
  },
  (t) => [
    uniqueIndex("sa_numero").on(t.numero),
    index("sa_tenant_email_fecha").on(t.tenantId, t.email, t.createdAt),
    check(
      "sa_largos",
      sql`char_length(${t.nombre}) <= 120 and char_length(${t.email}) <= 254 and char_length(${t.telefono}) <= 40 and char_length(coalesce(${t.pedidoNumero}, '')) <= 40 and char_length(coalesce(${t.motivo}, '')) <= 1000`,
    ),
  ],
);
