/**
 * Cupones del lado del Shop (spec apps/admin/docs/superpowers/specs/2026-11-01-cupones-design.md): leer
 * el código de la vista del CRM (`public.cupones_shop`), las reglas que dependen de la cuenta y el
 * canje (`shop.cupon_canjes`). El estado del canje NO se guarda: vivo / comprado / liberado se
 * calculan desde el pedido con `pedido-vivo.ts`, el mismo criterio que el stock y las campañas.
 *
 * SOLO servidor: usa la base.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crmCupones } from "@/db/crm";
import { cuponCanjes, orders } from "@/db/schema";
import type { OpcionCobro } from "../pagos/opciones-cobro";
import { pedidoCompradoSql, pedidoVivoSql } from "../pedido-vivo";
import { shopTenantId } from "../tenant";
import { mensajeCupon } from "./mensajes";
import { normalizarCodigo } from "./reglas";
import type { CuponError, CuponPedido, MotivoCupon, PromocionCupon } from "./tipos";

type Ejecutor = Pick<ReturnType<typeof getDb>, "execute">;
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Quién quiere usar el cupón. `clerkUserId` null = sin cuenta de la tienda (sólo cookie del CRM). */
export interface QuienCupon {
  clerkUserId: string | null;
  email: string | null;
  listaPrivada: boolean;
}

export type CuponResuelto =
  | { ok: true; promo: PromocionCupon; motivoCuenta: MotivoCupon | null; verificado: boolean }
  | { ok: false; error: CuponError };

export class CuponCanjeError extends Error {
  constructor(readonly motivo: MotivoCupon) {
    super(`cupón no canjeable: ${motivo}`);
    this.name = "CuponCanjeError";
  }
}

const error = (motivo: MotivoCupon): { ok: false; error: CuponError } => ({ ok: false, error: { motivo, mensaje: mensajeCupon(motivo) } });

/** La promoción de un código normalizado, o null. Sin caché (el límite y la pausa cambian); lanza si falla la base. */
export async function leerPromocionCupon(codigoNorm: string): Promise<PromocionCupon | null> {
  const [f] = await getDb()
    .select()
    .from(crmCupones)
    .where(and(eq(crmCupones.tenantId, shopTenantId()), eq(crmCupones.codigoNorm, codigoNorm)))
    .limit(1);
  if (!f) return null;
  return {
    codigoId: f.codigoId,
    codigo: f.codigo,
    promocionId: f.promocionId,
    nombre: f.nombre,
    tipo: f.tipo === "generica" ? "generica" : "unicos",
    pct: f.pct,
    envioGratis: f.envioGratis,
    provinciasEnvio: f.provinciasEnvio,
    inicio: new Date(f.inicio).toISOString(),
    fin: new Date(f.fin).toISOString(),
    venceEn: f.venceEn ? new Date(f.venceEn).toISOString() : null,
    soloPrimeraCompra: f.soloPrimeraCompra,
    minimo: f.minimo === null ? null : Number(f.minimo),
    medios: f.medios,
    formas: f.formas as OpcionCobro[] | null,
    permiteCuotas: f.permiteCuotas,
    limiteCanjes: f.limiteCanjes,
    condiciones: f.condiciones,
    activa: f.activa,
  };
}

/** El canje es de esta persona: misma cuenta de la tienda o mismo email (sin mayúsculas). */
function deLaPersona(k: string, q: QuienCupon) {
  const email = q.email?.trim().toLowerCase() || null;
  return email
    ? sql`(${sql.raw(k)}.clerk_user_id = ${q.clerkUserId} or lower(${sql.raw(k)}.email) = ${email})`
    : sql`${sql.raw(k)}.clerk_user_id = ${q.clerkUserId}`;
}

const excluir = (pedidoId?: string) => (pedidoId ? sql`and o.id <> ${pedidoId}::uuid` : sql``);

async function existe(ej: Ejecutor, consulta: ReturnType<typeof sql>): Promise<boolean> {
  const [r] = (await ej.execute(sql`select exists (${consulta}) as si`)) as unknown as { si: boolean }[];
  return Boolean(r?.si);
}

/**
 * El primer motivo de la cuenta que impide usar el cupón, o null. Orden: sin sesión → lista privada →
 * primera compra (un pedido comprado de la persona, o un canje vivo de OTRO código con primera compra:
 * frena abrir dos pedidos pendientes con dos códigos) → usado (único: canje vivo del código, de quien
 * sea; genérica: canje vivo de la promoción de esta persona) → agotado (canjes vivos ≥ límite).
 * `excluirPedidoId`: el pedido que se está creando o recotizando no cuenta.
 */
export async function motivoCuentaCupon(
  ej: Ejecutor,
  p: PromocionCupon,
  q: QuienCupon,
  excluirPedidoId?: string,
): Promise<MotivoCupon | null> {
  if (!q.clerkUserId) return "sin_sesion";
  if (q.listaPrivada) return "lista_privada";
  const tenant = shopTenantId();
  const email = q.email?.trim().toLowerCase() || null;

  if (p.soloPrimeraCompra) {
    const persona = email
      ? sql`(o.clerk_user_id = ${q.clerkUserId} or lower(o.cliente_email) = ${email})`
      : sql`o.clerk_user_id = ${q.clerkUserId}`;
    const compro = await existe(
      ej,
      sql`select 1 from shop.orders o where o.tenant_id = ${tenant} and ${persona} and ${pedidoCompradoSql("o")} ${excluir(excluirPedidoId)}`,
    );
    if (compro) return "no_primera_compra";
    const otroVivo = await existe(
      ej,
      sql`select 1 from shop.cupon_canjes k
          join shop.orders o on o.id = k.order_id
          join public.cupones_shop c on c.codigo_id = k.codigo_id and c.tenant_id = k.tenant_id
          where k.tenant_id = ${tenant} and k.codigo_id <> ${p.codigoId}::uuid and c.solo_primera_compra
            and ${deLaPersona("k", q)} and ${pedidoVivoSql("o")} ${excluir(excluirPedidoId)}`,
    );
    if (otroVivo) return "no_primera_compra";
  }

  const usado =
    p.tipo === "unicos"
      ? sql`select 1 from shop.cupon_canjes k join shop.orders o on o.id = k.order_id
            where k.tenant_id = ${tenant} and k.codigo_id = ${p.codigoId}::uuid and ${pedidoVivoSql("o")} ${excluir(excluirPedidoId)}`
      : sql`select 1 from shop.cupon_canjes k join shop.orders o on o.id = k.order_id
            where k.tenant_id = ${tenant} and k.promocion_id = ${p.promocionId}::uuid and ${deLaPersona("k", q)}
              and ${pedidoVivoSql("o")} ${excluir(excluirPedidoId)}`;
  if (await existe(ej, usado)) return "usado";

  if (p.limiteCanjes !== null) {
    const [r] = (await ej.execute(sql`
      select count(*)::int as n from shop.cupon_canjes k join shop.orders o on o.id = k.order_id
      where k.tenant_id = ${tenant} and k.promocion_id = ${p.promocionId}::uuid and ${pedidoVivoSql("o")} ${excluir(excluirPedidoId)}
    `)) as unknown as { n: number }[];
    if (Number(r?.n ?? 0) >= p.limiteCanjes) return "agotado";
  }
  return null;
}

/**
 * Lee y valida el código para cotizar. `null` si no se ingresó nada. `q = null` (invitado sin ninguna
 * identidad): se valida sin las reglas de la cuenta (`verificado: false`). Una falla de la base da
 * `no_disponible`: el comprador no paga más de lo que vio sin enterarse (lo corta `totalVisto`).
 */
export async function resolverCupon(raw: unknown, q: QuienCupon | null): Promise<CuponResuelto | null> {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  const norm = normalizarCodigo(raw);
  if (!norm) return error("no_existe");
  try {
    const promo = await leerPromocionCupon(norm);
    if (!promo) return error("no_existe");
    if (!q) return { ok: true, promo, motivoCuenta: null, verificado: false };
    return { ok: true, promo, motivoCuenta: await motivoCuentaCupon(getDb(), promo, q), verificado: true };
  } catch (err) {
    console.error("[cupones] no se pudo leer el cupón:", err instanceof Error ? err.message : err);
    return error("no_disponible");
  }
}

/**
 * Dentro de la transacción del pedido: advisory locks ordenados por código, promoción y cuenta (el
 * patrón de `bloquearItems`), se vuelven a mirar las reglas de la cuenta con el pedido excluido y
 * recién ahí se inserta. Dos checkouts con el mismo código: el segundo ve el canje del primero.
 */
export async function reservarCanjeEnTx(tx: Tx, p: PromocionCupon, q: QuienCupon, pedidoId: string, descuento: number): Promise<void> {
  const tenant = shopTenantId();
  const claves = [
    `shop-cupon-codigo:${tenant}:${p.codigoId}`,
    `shop-cupon-promo:${tenant}:${p.promocionId}`,
    ...(q.clerkUserId ? [`shop-cupon-usuario:${tenant}:${q.clerkUserId}`] : []),
  ];
  await tx.execute(
    sql`select pg_advisory_xact_lock(k) from (select distinct hashtextextended(c, 0) as k
        from unnest(array[${sql.join(claves.map((c) => sql`${c}`), sql`, `)}]::text[]) as t(c)) as claves order by k`,
  );
  const motivo = await motivoCuentaCupon(tx, p, q, pedidoId);
  if (motivo) throw new CuponCanjeError(motivo);
  await tx.insert(cuponCanjes).values({
    tenantId: tenant,
    codigoId: p.codigoId,
    promocionId: p.promocionId,
    orderId: pedidoId,
    clerkUserId: q.clerkUserId,
    email: q.email?.trim().toLowerCase() || null,
    descuentoTotal: descuento.toFixed(2),
  });
}

/** El pedido pierde el cupón (cambio a una opción no elegible): el código vuelve a servir. */
export async function liberarCanjeEnTx(tx: Pick<Tx, "delete">, pedidoId: string): Promise<void> {
  await tx.delete(cuponCanjes).where(eq(cuponCanjes.orderId, pedidoId));
}

/** La foto del cupón de un pedido de ESTE comprador (cambio de medio); null si no es suyo o no tiene. */
export async function cuponDelPedido(pedidoId: string, clerkUserId: string): Promise<CuponPedido | null> {
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId)) return null;
  const [f] = await getDb()
    .select({ cupon: orders.cupon })
    .from(orders)
    .where(and(eq(orders.id, pedidoId), eq(orders.tenantId, shopTenantId()), eq(orders.clerkUserId, clerkUserId)))
    .limit(1);
  return f?.cupon ?? null;
}
