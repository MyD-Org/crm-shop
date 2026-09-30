import { and, eq } from "drizzle-orm"
import { getDb, type Db } from "@/db"
import { shopOrders } from "@/db/shop-schema"

// `shop.orders.factura_cruzada` (0024 del Shop, change `sucursales-igz-mdp` rebanada B): la vista
// de reserva por sucursal mantiene la reserva de un pedido facturado por OTRA cuenta (factura
// cruzada) hasta entregarlo o cancelarlo. El CRM la escribe JUNTO con la factura (emitir) y la
// vuelve a false al desvincular. La copia "oficial" de la cuenta y la marca sigue siendo
// `public.pedido_factura_cuenta`; esta columna es lo que el Shop puede leer.

type Ejecutor = Pick<Db, "update">

export async function escribirFacturaCruzadaShop(
  tenantId: string,
  orderId: string,
  cruzada: boolean,
  ej: Ejecutor = getDb(),
): Promise<void> {
  await ej
    .update(shopOrders)
    .set({ facturaCruzada: cruzada, updatedAt: new Date() })
    .where(and(eq(shopOrders.id, orderId), eq(shopOrders.tenantId, tenantId)))
}
