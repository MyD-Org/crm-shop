import { notFound } from "next/navigation"
import { accesoSeccion } from "@/lib/secciones-acceso"
import { EnviosCard } from "@/components/admin/EnviosCard"
import { DespachoCard } from "@/components/admin/DespachoCard"
import { VentaSinStockCard } from "@/components/admin/VentaSinStockCard"
import { EnviosSucursalesCard } from "@/components/admin/EnviosSucursalesCard"
import { MetodosEnvioCard } from "@/components/admin/envios/MetodosEnvioCard"

export const dynamic = "force-dynamic"

// Envíos: si la tienda ofrece envío a domicilio, cuándo es gratis y qué plazo de despacho muestra.
// Dato maestro del negocio, por eso es una sección propia del menú (grupo Datos). Sección Envíos
// (sin ella → 404).
export default async function EnviosPage() {
  if (!(await accesoSeccion("envios"))) notFound()

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Envíos</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Envío a domicilio, envío gratis, envío en el día por zona, plazo de despacho, modalidades de venta sin stock y qué provincias atiende cada sucursal
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <EnviosCard />
        <MetodosEnvioCard />
        <DespachoCard />
        <VentaSinStockCard />
        <EnviosSucursalesCard />
      </div>
    </div>
  )
}
