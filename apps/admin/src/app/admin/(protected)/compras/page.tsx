import { notFound } from "next/navigation"
import { Button } from "@myd-org/ui"
import { ComprasLista } from "@/components/admin/compras/ComprasLista"
import { accesoCompras } from "@/lib/compras-acceso"
import { listarCuentasCompras } from "@/lib/compras-config-repo"
import { toCompraListaDto } from "@/lib/compras-http"
import { listarCompras } from "@/lib/compras-repo"

export const dynamic = "force-dynamic"

// Compras en tránsito: facturas de proveedor registradas en Alegra antes de recibir la mercadería.
// Acceso: rol «compras», admin o superadmin, con el flag `compras-en-transito` (sin acceso → 404).
export default async function ComprasPage() {
  const acceso = await accesoCompras()
  if (!acceso) notFound()

  const [filas, cuentas] = await Promise.all([
    listarCompras(acceso.tenantId, { limit: 50 }),
    listarCuentasCompras(acceso.tenantId),
  ])

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 pl-10 md:pl-0">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Compras</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
            Facturas de proveedores registradas en Alegra mientras la mercadería está en camino
          </p>
        </div>
        <Button href="/admin/compras/nueva">Nueva compra</Button>
      </div>
      <ComprasLista
        compras={filas.map(toCompraListaDto)}
        cuentas={cuentas.map((c) => ({ id: c.id, nombre: c.nombre }))}
      />
    </div>
  )
}
