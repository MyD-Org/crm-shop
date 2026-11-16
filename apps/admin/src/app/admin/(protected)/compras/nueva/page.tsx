import { notFound } from "next/navigation"
import { NuevaCompraForm } from "@/components/admin/compras/NuevaCompraForm"
import { accesoCompras } from "@/lib/compras-acceso"
import { listarCuentasCompras, nombresPercepcionPorCuenta } from "@/lib/compras-config-repo"

export const dynamic = "force-dynamic"

export default async function NuevaCompraPage() {
  const acceso = await accesoCompras()
  if (!acceso) notFound()

  const cuentas = await listarCuentasCompras(acceso.tenantId)
  const percepciones = await nombresPercepcionPorCuenta(acceso.tenantId, cuentas)

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Nueva compra</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Registre la factura del proveedor: la mercadería queda «en tránsito» hasta que se reciba
        </p>
      </div>
      {cuentas.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>No hay cuentas de Alegra activas para registrar compras.</p>
      ) : (
        <NuevaCompraForm
          cuentas={cuentas.map((c) => ({ slug: c.slug, nombre: c.nombre }))}
          percepcionesPorCuenta={percepciones}
          esAdmin={acceso.esAdmin}
        />
      )}
    </div>
  )
}
