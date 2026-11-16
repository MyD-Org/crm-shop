import { notFound } from "next/navigation"
import { CompraDetalle } from "@/components/admin/compras/CompraDetalle"
import { accesoCompras } from "@/lib/compras-acceso"
import { listarCuentasCompras } from "@/lib/compras-config-repo"
import { esUuid, toCompraDetalleDto } from "@/lib/compras-http"
import { detalleCompra } from "@/lib/compras-service"

export const dynamic = "force-dynamic"

export default async function CompraDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const acceso = await accesoCompras()
  if (!acceso) notFound()
  const { id } = await params
  if (!esUuid(id)) notFound()

  // Si la compra quedó en 'creando' (corte con Alegra), se reconcilia al abrirla.
  const compra = await detalleCompra(acceso.tenantId, id)
  if (!compra) notFound()
  const cuentas = await listarCuentasCompras(acceso.tenantId)

  return (
    <div className="p-4 md:p-6">
      <CompraDetalle
        compra={toCompraDetalleDto(compra)}
        cuentaNombre={cuentas.find((c) => c.id === compra.cuentaId)?.nombre ?? "—"}
        edicionHabilitada={acceso.edicionHabilitada}
      />
    </div>
  )
}
