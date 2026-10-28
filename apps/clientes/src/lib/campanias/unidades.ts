/**
 * Límite de unidades a precio de campaña (spec apps/admin/docs/superpowers/specs/
 * 2026-10-28-campanias-precios-design.md, "Límite de unidades"). Una regla de producto puede llevar
 * `unidades`; se cuentan las de los pedidos de la tienda con esa regla (`order_items.campania_regla_id`,
 * migración 0039 del Shop): pagados y pendientes con la reserva viva, con el mismo criterio que
 * `shop.stock_reservado`, pero SIN filtrar los facturados (un pedido facturado sigue contando). Un
 * pedido cancelado o vencido libera sus unidades. No cuenta ventas del local (decisión de la spec).
 *
 * Agotada una regla, el producto vuelve solo al precio normal (`resolverPrecioVigente` la saltea);
 * el pedido lo valida dentro de su transacción con un advisory lock por regla (`validarUnidadesEnTx`).
 */
import { sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { shopTenantId } from "../tenant";
import { mapCampanias, type EntradaCampania } from "./precio";

type Ejecutor = Pick<ReturnType<typeof getDb>, "execute">;

/** Las reglas con límite de las campañas activas que aparecen en estas entradas: reglaId → unidades. */
export function reglasConLimite(
  entradasPorProducto: Iterable<readonly EntradaCampania[] | undefined>,
  activas: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const entradas of entradasPorProducto) {
    for (const e of entradas ?? []) {
      if (activas.has(e.id) && e.unidades != null && !out.has(e.reglaId)) out.set(e.reglaId, e.unidades);
    }
  }
  return out;
}

/** Unidades que quedan por regla: límite − usadas, nunca negativo. */
export function quedanDe(limites: ReadonlyMap<string, number>, usadas: ReadonlyMap<string, number>): Map<string, number> {
  return new Map([...limites].map(([regla, limite]) => [regla, Math.max(0, limite - (usadas.get(regla) ?? 0))]));
}

/** Unidades vendidas en la tienda por regla (ver el criterio arriba). `excluirPedidoId`: al recotizar. */
export async function unidadesUsadas(
  ej: Ejecutor,
  reglaIds: readonly string[],
  excluirPedidoId?: string,
): Promise<Map<string, number>> {
  if (reglaIds.length === 0) return new Map();
  const ids = sql`array[${sql.join(reglaIds.map((r) => sql`${r}`), sql`, `)}]::uuid[]`;
  const filas = (await ej.execute(sql`
    select oi.campania_regla_id::text as regla, coalesce(sum(oi.qty), 0)::float8 as n
    from shop.order_items oi
    join shop.orders o on o.id = oi.order_id
    where o.tenant_id = ${shopTenantId()}
      and oi.campania_regla_id = any(${ids})
      and o.estado <> 'cancelado'
      and (o.estado <> 'pendiente' or o.pago_estado = 'pagado'
           or coalesce(o.reserva_vence_en, o.created_at + interval '24 hours') > now())
      ${excluirPedidoId ? sql`and o.id <> ${excluirPedidoId}::uuid` : sql``}
    group by oi.campania_regla_id
  `)) as unknown as { regla: string; n: number }[];
  return new Map(filas.map((f) => [f.regla, Number(f.n)]));
}

/** Lo que queda de cada regla con límite de estas entradas (una lectura). Sin reglas con límite: vacío. */
export async function quedanParaEntradas(
  ej: Ejecutor,
  entradasPorProducto: Iterable<readonly EntradaCampania[] | undefined>,
  activas: ReadonlySet<string>,
  excluirPedidoId?: string,
): Promise<Map<string, number>> {
  const limites = reglasConLimite(entradasPorProducto, activas);
  if (limites.size === 0) return new Map();
  return quedanDe(limites, await unidadesUsadas(ej, [...limites.keys()], excluirPedidoId));
}

export class UnidadesCampaniaError extends Error {
  constructor(
    readonly reglaId: string,
    readonly quedan: number,
    readonly ids: string[],
  ) {
    super(`Quedan ${quedan} unidades a precio de campaña`);
    this.name = "UnidadesCampaniaError";
  }
}

/**
 * Dentro de la transacción del pedido (después de los locks de stock y antes de escribir las líneas):
 * por cada regla con límite de las líneas, toma un advisory lock por regla (en orden, sin deadlocks),
 * relee el límite de la vista del CRM y las unidades vendidas, y tira `UnidadesCampaniaError` si lo
 * pedido no entra. Las variantes de un modelo comparten la regla: se suman.
 */
export async function validarUnidadesEnTx(
  tx: Ejecutor,
  lineas: readonly { id: string; qty: number; campaniaReglaId?: string }[],
): Promise<void> {
  const pedidas = new Map<string, { qty: number; ids: string[] }>();
  for (const l of lineas) {
    if (!l.campaniaReglaId) continue;
    const p = pedidas.get(l.campaniaReglaId) ?? { qty: 0, ids: [] };
    p.qty += l.qty;
    p.ids.push(l.id);
    pedidas.set(l.campaniaReglaId, p);
  }
  if (pedidas.size === 0) return;
  const reglas = [...pedidas.keys()].sort();
  await tx.execute(
    sql`select pg_advisory_xact_lock(k) from (select distinct hashtextextended('shop-campania-regla:' || ${shopTenantId()} || ':' || r, 0) as k
        from unnest(array[${sql.join(reglas.map((r) => sql`${r}`), sql`, `)}]::text[]) as t(r)) as claves order by k`,
  );
  // El límite vigente sale de la vista del CRM (lo que se cotizó pudo cambiar).
  const ids = [...new Set([...pedidas.values()].flatMap((p) => p.ids))];
  const filas = (await tx.execute(sql`
    select campanias_online as c from public.catalog_products_shop
    where tenant_id = ${shopTenantId()} and alegra_id = any(array[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::text[])
  `)) as unknown as { c: unknown }[];
  const limites = new Map<string, number>();
  for (const f of filas) {
    for (const e of mapCampanias(f.c)) if (pedidas.has(e.reglaId) && e.unidades != null) limites.set(e.reglaId, e.unidades);
  }
  if (limites.size === 0) return;
  const usadas = await unidadesUsadas(tx, [...limites.keys()]);
  for (const [regla, limite] of limites) {
    const quedan = Math.max(0, limite - (usadas.get(regla) ?? 0));
    const p = pedidas.get(regla)!;
    if (p.qty > quedan) throw new UnidadesCampaniaError(regla, quedan, p.ids);
  }
}
