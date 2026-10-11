import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { eventosDePieza, obtenerPieza } from "@/lib/marketing/piezas-repo"
import { listarMaterial } from "@/lib/marketing/otros-repo"
import { PiezaDetalle } from "@/components/admin/marketing/PiezaDetalle"

export const dynamic = "force-dynamic"

export default async function PiezaPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()
  const { id } = await params
  const pieza = await obtenerPieza(guard.tenantId, id)
  if (!pieza) notFound()
  const [eventos, material] = await Promise.all([eventosDePieza(guard.tenantId, id), listarMaterial(guard.tenantId, id)])
  return (
    <div className="p-4 md:p-6">
      <PiezaDetalle pieza={pieza} eventos={eventos} material={material} />
    </div>
  )
}
