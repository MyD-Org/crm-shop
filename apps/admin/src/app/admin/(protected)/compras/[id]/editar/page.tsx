import { notFound } from "next/navigation"
import type { CompraInicial } from "@/components/admin/compras/NuevaCompraForm"
import { NuevaCompraForm } from "@/components/admin/compras/NuevaCompraForm"
import { accesoCompras } from "@/lib/compras-acceso"
import { listarCuentasCompras, nombresPercepcionPorCuenta } from "@/lib/compras-config-repo"
import { accionesDeCompra } from "@/lib/compras-formato"
import { esUuid } from "@/lib/compras-http"
import { obtenerCompra } from "@/lib/compras-repo"

export const dynamic = "force-dynamic"

// Editar ítems y percepciones de una compra pendiente y sin recepciones. Requiere además el flag
// `compras-recepcion` (sin él, 404).
export default async function EditarCompraPage({ params }: { params: Promise<{ id: string }> }) {
  const acceso = await accesoCompras()
  if (!acceso || !acceso.edicionHabilitada) notFound()
  const { id } = await params
  if (!esUuid(id)) notFound()

  const compra = await obtenerCompra(acceso.tenantId, id)
  if (!compra) notFound()
  if (!accionesDeCompra(compra.estado, compra.recepciones.length > 0).editar) notFound()

  const cuentas = await listarCuentasCompras(acceso.tenantId)
  const cuenta = cuentas.find((c) => c.id === compra.cuentaId)
  if (!cuenta) notFound()
  const percepciones = await nombresPercepcionPorCuenta(acceso.tenantId, cuentas)

  const inicial: CompraInicial = {
    compraId: compra.id,
    cuentaSlug: cuenta.slug,
    proveedor: { id: compra.proveedorAlegraId, nombre: compra.proveedorNombre, cuit: compra.proveedorCuit },
    numeroFactura: compra.numeroFactura,
    fecha: compra.fecha,
    vencimiento: compra.vencimiento,
    observaciones: compra.observaciones ?? "",
    items: compra.items.map((i) => ({
      alegraId: i.alegraId,
      nombre: i.nombre,
      codigo: i.codigo,
      cantidad: String(Number(i.cantidadPedida)),
      costo: (i.costoUnitarioCentavos / 100).toFixed(2),
      iva: String(Number(i.ivaPorcentaje)),
    })),
    percepciones: compra.percepcionesDetalle.map((p) => ({
      nombre: p.nombre,
      importe: (p.importeCentavos / 100).toFixed(2),
      certificado: p.numeroCertificado ?? "",
    })),
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Editar compra</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          {compra.proveedorNombre} · factura {compra.numeroFactura}
        </p>
      </div>
      <NuevaCompraForm
        cuentas={[{ slug: cuenta.slug, nombre: cuenta.nombre }]}
        percepcionesPorCuenta={percepciones}
        esAdmin={acceso.esAdmin}
        inicial={inicial}
      />
    </div>
  )
}
