import { sql, type SQL } from "drizzle-orm"
import { getDb } from "@/db"
import { patronBusqueda } from "@/lib/clientes-tienda-repo"
import { formatearNumeroPedido } from "@/lib/pagos-intentos-repo"

// "Carritos abandonados" del admin: carritos del Shop (`shop.carts`, sólo compradores con sesión)
// con ítems que no tienen actividad hace N horas, con el monto de referencia y la marca de si el
// comprador tiene un pedido pendiente de pago en línea.
//
// Reglas de este archivo:
//  - `tenantId` es SIEMPRE el primer argumento y se filtra en carritos, clientes, catálogo, overlay
//    y pedidos (un clerk_user_id repetido en dos tiendas no mezcla datos).
//  - SQL crudo parametrizado. Sólo lectura: el Shop escribe los carritos.
//  - Monto referencial = precio GENERAL que muestra la web, por la cantidad: la lista online general
//    (`precios_online`, la `main` o la primera), o el de campaña de esa lista si hay una campaña
//    activa (sin agotar su límite de unidades), con IVA y el redondeo de `precioFinal()` del Shop.
//    No replica precios por medio de pago ni listas propias de la cuenta: la UI lo rotula así.
//    Los ítems sin espejo o sin precio online se cuentan como `faltantes` (monto parcial).

export const CARRITOS_DEFAULT_LIMIT = 25
export const CARRITOS_MAX_LIMIT = 50
/** Largo máximo de la búsqueda (la API responde 400 por encima). */
export const CARRITOS_Q_MAX = 100

/** Horas sin actividad a partir de las cuales un carrito se considera abandonado (default 1). */
export const HORAS_INACTIVIDAD = [1, 6, 24, 72] as const
export const HORAS_INACTIVIDAD_DEFAULT = 1
/** Antigüedad máxima de la última actividad, para no listar carritos muertos de siempre (default 30). */
export const DIAS_ANTIGUEDAD = [7, 30, 90] as const
export const DIAS_ANTIGUEDAD_DEFAULT = 30
export const FILTROS_PEDIDO = ["todos", "sin_pedido", "con_pedido_pendiente"] as const
export type FiltroPedidoCarrito = (typeof FILTROS_PEDIDO)[number]

/** Un pedido pendiente en línea sólo "pisa" al carrito dentro de esta ventana (igual que el Shop). */
const HORAS_PEDIDO_PENDIENTE = 24
/** Medios que se cobran en línea: el resto (transferencia, efectivo, cuenta corriente, a coordinar) no. */
const MEDIOS_EN_LINEA = ["mercadopago", "payway"] as const

export interface ListarCarritosFiltro {
  horas?: number
  dias?: number
  pedido?: FiltroPedidoCarrito
  q?: string
  start?: number
  /** Default CARRITOS_DEFAULT_LIMIT, máximo CARRITOS_MAX_LIMIT. */
  limit?: number
}

export interface CarritoProductoDto {
  nombre: string | null
  brand: string | null
  /** Código del producto (`reference` de Alegra), el mismo que muestra la ficha de la web. */
  codigo: string | null
  qty: number
}

export interface CarritoAbandonadoDto {
  clerkUserId: string
  nombre: string | null
  email: string | null
  /** Ítems distintos del carrito. */
  lineas: number
  /** Suma de cantidades. */
  unidades: number
  /** Precio general de la web (con IVA) x cantidad, sólo de los ítems con precio. */
  montoReferencial: number
  /** Ítems sin espejo o sin precio (si > 0, el monto es parcial). */
  faltantes: number
  /** Desde cuándo tiene ítems (ISO); null en carritos anteriores a la 0041 del Shop sin dato. */
  conItemsDesde: string | null
  /** Última actividad (ISO). */
  ultimaActividad: string
  horasInactivo: number
  pedidoPendiente: { id: string; numero: number; numeroTexto: string } | null
  /** Los primeros 3 productos. */
  productos: CarritoProductoDto[]
}

interface FilaCarrito {
  clerk_user_id: string
  nombre: string | null
  email: string | null
  lineas: number
  unidades: string | number
  monto: string | number
  faltantes: number
  con_items_desde: Date | string | null
  updated_at: Date | string
  horas_inactivo: string | number
  pedido_id: string | null
  pedido_numero: number | null
  productos: { nombre: string | null; brand: string | null; codigo: string | null; qty: number | string }[] | null
}

const iso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString()
const n = (v: string | number | null | undefined): number => {
  const x = Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}

function aDto(f: FilaCarrito): CarritoAbandonadoDto {
  return {
    clerkUserId: f.clerk_user_id,
    nombre: f.nombre,
    email: f.email,
    lineas: n(f.lineas),
    unidades: n(f.unidades),
    montoReferencial: n(f.monto),
    faltantes: n(f.faltantes),
    conItemsDesde: f.con_items_desde ? iso(f.con_items_desde) : null,
    ultimaActividad: iso(f.updated_at),
    horasInactivo: Math.floor(n(f.horas_inactivo)),
    pedidoPendiente: f.pedido_id
      ? {
          id: f.pedido_id,
          numero: n(f.pedido_numero),
          numeroTexto: formatearNumeroPedido(n(f.pedido_numero)),
        }
      : null,
    productos: (f.productos ?? []).map((p) => ({
      nombre: p.nombre,
      brand: p.brand,
      codigo: p.codigo?.trim() || null,
      qty: n(p.qty),
    })),
  }
}

/**
 * Precio unitario que muestra la web como precio general (lo usa el LATERAL de cada ítem, con
 * `cp` = catalog_products y `gral` = la entrada general de `precios_online`):
 *  1. Neto: el de campaña de la lista general si alguna entrada de `campanias_online` es de una
 *     campaña activa ahora (inicio inclusivo, fin exclusivo) y no agotó su límite de unidades —
 *     mismo criterio que `precioVigenteSql` / `unidadesUsadas` del Shop—; si no, el de la lista.
 *  2. Con IVA y el redondeo de `precioFinal()` del Shop: neto al centavo + IVA al centavo. Sin
 *     alícuota conocida, el neto (la web muestra el neto en ese caso).
 * Sin precio online (o <= 0) da NULL: el ítem cuenta como faltante, igual que en la web, que no
 * lo lista.
 */
const precioWebSql = sql`(
  SELECT CASE
           WHEN v.neto IS NULL OR v.neto <= 0 THEN NULL
           WHEN cp.iva_porcentaje IS NULL THEN round(v.neto, 2)
           ELSE round(v.neto, 2) + round(round(v.neto, 2) * cp.iva_porcentaje / 100, 2)
         END
  FROM (
    SELECT coalesce((
      SELECT (pe->>'price')::numeric
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(cp.campanias_online) = 'array' THEN cp.campanias_online ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS e(value, pos)
      JOIN public.campanias ca
        ON ca.tenant_id = cp.tenant_id AND ca.id::text = e.value->>'id'
       AND ca.inicio <= now() AND now() < ca.fin
      CROSS JOIN jsonb_array_elements(
        CASE WHEN jsonb_typeof(e.value->'precios') = 'array' THEN e.value->'precios' ELSE '[]'::jsonb END
      ) pe
      WHERE pe->>'idPriceList' = gral.id_lista
        AND (pe->>'price')::numeric > 0
        AND (e.value->>'unidades' IS NULL OR (
          SELECT coalesce(sum(oi.qty), 0)
          FROM shop.order_items oi
          JOIN shop.orders o ON o.id = oi.order_id
          WHERE o.tenant_id = cp.tenant_id
            AND oi.campania_regla_id::text = e.value->>'reglaId'
            AND o.estado <> 'cancelado'
            AND (o.estado <> 'pendiente' OR o.pago_estado = 'pagado'
                 OR coalesce(o.reserva_vence_en, o.created_at + interval '24 hours') > now())
        ) < (e.value->>'unidades')::numeric)
      ORDER BY e.pos
      LIMIT 1
    ), gral.precio) AS neto
  ) v
)`

const enLista = <T extends number>(v: number | undefined, validos: readonly T[], def: T): T =>
  (validos as readonly number[]).includes(v ?? NaN) ? (v as T) : def

export async function listarCarritosAbandonados(
  tenantId: string,
  f: ListarCarritosFiltro = {},
): Promise<{ items: CarritoAbandonadoDto[]; total: number; montoTotalReferencial: number }> {
  const start = Math.max(0, Math.trunc(f.start ?? 0) || 0)
  const limit = Math.min(
    CARRITOS_MAX_LIMIT,
    Math.max(1, Math.trunc(f.limit ?? CARRITOS_DEFAULT_LIMIT) || CARRITOS_DEFAULT_LIMIT),
  )
  const horas = enLista(f.horas, HORAS_INACTIVIDAD, HORAS_INACTIVIDAD_DEFAULT)
  const dias = enLista(f.dias, DIAS_ANTIGUEDAD, DIAS_ANTIGUEDAD_DEFAULT)
  const q = (f.q ?? "").trim().slice(0, CARRITOS_Q_MAX)

  const busqueda: SQL = q
    ? sql`AND (cl.nombre ILIKE ${patronBusqueda(q)} OR cl.email_norm LIKE ${patronBusqueda(q.toLowerCase())})`
    : sql``

  // Precio general de la web: ver `precioWebSql`.
  const base = sql`
    WITH base AS (
      SELECT c.clerk_user_id, cl.nombre, cl.email,
             jsonb_array_length(c.items)::int AS lineas,
             t.unidades, t.monto, t.faltantes,
             c.con_items_desde, c.updated_at,
             extract(epoch FROM (now() - c.updated_at)) / 3600 AS horas_inactivo,
             pp.id::text AS pedido_id, pp.numero AS pedido_numero,
             pr.productos
      FROM shop.carts c
      JOIN shop.clientes cl
        ON cl.tenant_id = c.tenant_id AND cl.clerk_user_id = c.clerk_user_id AND cl.eliminado_en IS NULL
      CROSS JOIN LATERAL (
        SELECT coalesce(sum((it.value->>'qty')::numeric), 0) AS unidades,
               coalesce(sum(p.precio * (it.value->>'qty')::numeric), 0) AS monto,
               count(*) FILTER (WHERE p.precio IS NULL)::int AS faltantes
        FROM jsonb_array_elements(c.items) AS it(value)
        LEFT JOIN LATERAL (
          SELECT ${precioWebSql} AS precio
          FROM public.catalog_products cp
          LEFT JOIN LATERAL (
            SELECT e.value->>'idPriceList' AS id_lista, (e.value->>'price')::numeric AS precio
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(cp.precios_online) = 'array' THEN cp.precios_online ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS e(value, pos)
            ORDER BY coalesce((e.value->>'main') = 'true', false) DESC, e.pos
            LIMIT 1
          ) gral ON true
          WHERE cp.tenant_id = c.tenant_id AND cp.alegra_id = it.value->>'id'
          LIMIT 1
        ) p ON true
      ) t
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
                 jsonb_build_object('nombre', x.nombre, 'brand', x.brand, 'codigo', x.codigo, 'qty', x.qty)
                 ORDER BY x.pos
               ) AS productos
        FROM (
          SELECT it.pos, coalesce(ov.nombre, cp.name) AS nombre, cp.brand, cp.code AS codigo,
                 (it.value->>'qty')::numeric AS qty
          FROM jsonb_array_elements(c.items) WITH ORDINALITY AS it(value, pos)
          LEFT JOIN public.catalog_products cp
            ON cp.tenant_id = c.tenant_id AND cp.alegra_id = it.value->>'id'
          LEFT JOIN public.catalog_overlay ov
            ON ov.tenant_id = c.tenant_id AND ov.alegra_id = it.value->>'id'
          ORDER BY it.pos
          LIMIT 3
        ) x
      ) pr ON true
      LEFT JOIN LATERAL (
        SELECT o.id, o.numero
        FROM shop.orders o
        WHERE o.tenant_id = c.tenant_id
          AND o.clerk_user_id = c.clerk_user_id
          AND o.pago_estado = 'pendiente'
          AND o.estado <> 'cancelado'
          AND o.pago_metodo IN (${sql.join(MEDIOS_EN_LINEA.map((m) => sql`${m}`), sql`, `)})
          AND o.created_at >= now() - make_interval(hours => ${HORAS_PEDIDO_PENDIENTE}::int)
        ORDER BY o.created_at DESC
        LIMIT 1
      ) pp ON true
      WHERE c.tenant_id = ${tenantId}
        AND jsonb_array_length(c.items) > 0
        AND c.updated_at <= now() - make_interval(hours => ${horas}::int)
        AND c.updated_at >= now() - make_interval(days => ${dias}::int)
        ${busqueda}
    )`

  const where: SQL =
    f.pedido === "sin_pedido"
      ? sql`WHERE pedido_id IS NULL`
      : f.pedido === "con_pedido_pendiente"
        ? sql`WHERE pedido_id IS NOT NULL`
        : sql``

  // Sin JIT: los `jsonb_array_elements` anidados inflan el costo estimado (~800k, por encima de
  // `jit_above_cost` y de los umbrales de inlining/optimización) aunque los datos sean pocos, y en
  // un Postgres con LLVM compilar la consulta tardaba ~4 s por llamada. `SET LOCAL` vale sólo para
  // esta transacción de lectura.
  const [filas, conteo] = await getDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL jit = off`)
    const pagina = await tx.execute(sql`
      ${base}
      SELECT * FROM base ${where}
      ORDER BY updated_at DESC, clerk_user_id
      LIMIT ${limit} OFFSET ${start}
    `)
    const totales = await tx.execute(sql`
      ${base}
      SELECT count(*)::int AS total, coalesce(sum(monto), 0) AS monto FROM base ${where}
    `)
    return [pagina, totales] as const
  })

  const resumen = (conteo as unknown as { total: number; monto: string | number }[])[0]
  return {
    items: (filas as unknown as FilaCarrito[]).map(aDto),
    total: n(resumen?.total),
    montoTotalReferencial: n(resumen?.monto),
  }
}
