/**
 * Reclamo de los pedidos de un invitado por quien después crea (o ya tiene) una cuenta con ese email
 * (change `compra-como-invitado`, S3). SOLO servidor.
 *
 * Es IDEMPOTENTE y se puede correr cuantas veces haga falta (no es "una vez por usuario"):
 *  - el webhook de Clerk (`user.created` / `user.updated`), y
 *  - de forma perezosa en `identidadActual`, con un límite de una vez cada 10 minutos por usuario.
 * Sólo toca pedidos que siguen sin dueño (`clerk_user_id IS NULL` y `cliente_codigo IS NULL`), de
 * invitado, de este tenant, del mismo email, no cancelados y de los últimos 30 días. El email llega
 * ya VERIFICADO por Clerk: sin eso nadie reclama nada (quien conoce un correo ajeno no se lleva los
 * pedidos de esa persona registrándose con él sin verificarlo). Usa el índice parcial
 * `orders_invitado_email_idx` (tenant, lower(email), created_at).
 *
 * Tras reclamar, `esDeSuDueno` abre el pedido por `clerk_user_id` (aparece en Mi cuenta) y el token de
 * compra del invitado deja de valer (su condición exige `clerk_user_id IS NULL`); el link «Pagar su
 * pedido» sigue sirviendo mientras el pedido esté pendiente.
 */
import { after } from "next/server";
import { and, gt, isNull, ne, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { permitirAsync } from "./rate-limit";
import { shopTenantId } from "./tenant";

/** Ventana de reclamo: sólo pedidos de invitado de los últimos N días. */
export const VENTANA_RECLAMO_DIAS = 30;
/** Cada cuánto, como máximo, corre el reclamo perezoso de un mismo usuario. */
export const INTERVALO_RECLAMO_MS = 10 * 60_000;

const DIA_MS = 24 * 60 * 60_000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** `lower(cliente_email)` de los pedidos de invitado se guarda en minúsculas; acá igual. */
export function normalizarEmailReclamo(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e && e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

/**
 * Asocia a `clerkUserId` los pedidos de invitado con `emailVerificado`. Devuelve los ids reclamados.
 * Lanza si la base falla (cada llamador decide qué hacer: el webhook lo loguea y responde 200).
 */
export async function reclamarPedidosInvitado(
  tenantId: string,
  clerkUserId: string,
  emailVerificado: string | null | undefined,
  ahora: Date = new Date(),
): Promise<string[]> {
  const email = normalizarEmailReclamo(emailVerificado);
  if (!email || !clerkUserId) return [];
  const desde = new Date(ahora.getTime() - VENTANA_RECLAMO_DIAS * DIA_MS);
  const filas = await getDb()
    .update(orders)
    .set({ clerkUserId })
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.compraInvitado, true),
        isNull(orders.clerkUserId),
        isNull(orders.clienteCodigo),
        sql`lower(${orders.clienteEmail}) = ${email}`,
        ne(orders.estado, "cancelado"),
        gt(orders.createdAt, desde),
      ),
    )
    .returning({ id: orders.id });
  return filas.map((f) => f.id);
}

/**
 * Reclamo perezoso: se programa para DESPUÉS de la respuesta (`after`), con un límite de una vez cada
 * 10 minutos por usuario (Redis; si cae, memoria). Nunca bloquea ni hace fallar a quien lo llama, y
 * sólo se loguea el id del usuario y la cantidad (nunca el email).
 */
export function programarReclamoInvitado(clerkUserId: string, emailVerificado: string): void {
  try {
    after(async () => {
      try {
        if (!(await permitirAsync(`reclamo:${clerkUserId}`, 1, INTERVALO_RECLAMO_MS))) return;
        const ids = await reclamarPedidosInvitado(shopTenantId(), clerkUserId, emailVerificado);
        if (ids.length > 0) console.info(`reclamo-invitado usuario=${clerkUserId} reclamados=${ids.length}`);
      } catch (err) {
        console.error(`reclamo-invitado usuario=${clerkUserId} error=${err instanceof Error ? err.name : "desconocido"}`);
      }
    });
  } catch {
    // Fuera de un request (tests, scripts): no hay dónde programarlo y no es un error.
  }
}
