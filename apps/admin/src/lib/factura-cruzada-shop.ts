import { sql } from "drizzle-orm"
import { getDb, type Db } from "@/db"
import { facturaCruzadaDisponible } from "@/lib/shop-columnas"

// `shop.orders.factura_cruzada` (0024 del Shop, change `sucursales-igz-mdp` rebanada B): la vista
// de reserva por sucursal mantiene la reserva de un pedido facturado por OTRA cuenta (factura
// cruzada) hasta entregarlo o cancelarlo. El CRM la escribe JUNTO con la factura (emitir) y la
// vuelve a false al desvincular. La copia "oficial" de la cuenta y la marca sigue siendo
// `public.pedido_factura_cuenta`; esta columna es lo que el Shop puede leer.
//
// SQL puro guardado por la existencia de la columna (ver `shop-columnas.ts`): si la migración del
// Shop todavía no está aplicada no hace nada y devuelve false.
// TODO(sucursales-igz-mdp B): pasar a drizzle cuando `shop-schema.ts` declare la columna.

type Ejecutor = Pick<Db, "execute">

/** ¿Se escribió? false = la columna todavía no existe en esta base (no es un error). */
export async function escribirFacturaCruzadaShop(
  tenantId: string,
  orderId: string,
  cruzada: boolean,
  ej: Ejecutor = getDb(),
): Promise<boolean> {
  if (!(await facturaCruzadaDisponible())) return false
  await ej.execute(sql`
    update shop.orders set factura_cruzada = ${cruzada}, updated_at = now()
    where id = ${orderId}::uuid and tenant_id = ${tenantId}
  `)
  return true
}
