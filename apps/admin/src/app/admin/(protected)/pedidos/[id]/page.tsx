import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { getPedido, toPedidoDetalleDto } from "@/lib/pedidos-repo"
import { isKnownAdminRole } from "@/lib/roles"
import { PedidoDetalle } from "@/components/admin/pedidos/PedidoDetalle"

export const dynamic = "force-dynamic"

// Misma autorización que la lista y que la API (operator | admin | superadmin). Un pedido de
// otro tenant, un id inexistente y un id mal formado dan el MISMO 404: `getPedido` filtra por
// el tenant del guard y valida el uuid antes de consultar.
export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || !isKnownAdminRole(guard.user.role)) notFound()

  const { id } = await params
  const encontrado = await getPedido(guard.tenantId, id)
  if (!encontrado) notFound()

  return (
    <div className="p-4 md:p-6">
      <PedidoDetalle initial={toPedidoDetalleDto(encontrado.pedido, encontrado.items)} />
    </div>
  )
}
