import { and, eq, isNull, ne, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { shopOrders } from "@/db/shop-schema"
import { leerReglasVenta } from "@/lib/reglas-venta-repo"

// "Extender reserva" (change `sucursales-igz-mdp`, rebanada B): a un pendiente sin pago le corre el
// vencimiento de la reserva a `ahora + reglas.reserva_dias` (0 = nunca vence, `infinity`). Solo
// aplica mientras el pedido reserva por vencimiento; todo filtra por el tenant del guard.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ResultadoExtender =
  | { kind: "ok"; venceEn: Date | null }
  | { kind: "not_found" }
  | { kind: "no_aplica" }

export async function extenderReserva(tenantId: string, id: string, now: Date = new Date()): Promise<ResultadoExtender> {
  if (!UUID_RE.test(id)) return { kind: "not_found" }
  const { reservaDias } = await leerReglasVenta(tenantId)
  const nuevo = reservaDias > 0 ? new Date(now.getTime() + reservaDias * 86_400_000) : null

  const db = getDb()
  const filas = await db
    .update(shopOrders)
    .set({ reservaVenceEn: nuevo ?? sql`'infinity'::timestamptz`, updatedAt: now })
    .where(
      and(
        eq(shopOrders.id, id),
        eq(shopOrders.tenantId, tenantId),
        eq(shopOrders.estado, "pendiente"),
        ne(shopOrders.pagoEstado, "pagado"),
        isNull(shopOrders.facturadoEn),
      ),
    )
    .returning({ id: shopOrders.id })
  if (filas.length > 0) return { kind: "ok", venceEn: nuevo }

  const [existe] = await db
    .select({ id: shopOrders.id })
    .from(shopOrders)
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId)))
  return existe ? { kind: "no_aplica" } : { kind: "not_found" }
}
