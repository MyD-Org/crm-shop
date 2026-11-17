import { notFound } from "next/navigation"
import { accesoSeccion } from "@/lib/secciones-acceso"
import { TemplateManager } from "@/components/admin/TemplateManager"

export const dynamic = "force-dynamic"

// Gestión de plantillas de WhatsApp. Solo superadmin (sección fija `plantillas`): crea recursos
// reales en Meta. Rol de la fila fresca, nunca el de la cookie.
export default async function PlantillasPage() {
  if (!(await accesoSeccion("plantillas"))) notFound()

  return (
    <div className="p-4 md:p-6">
      <TemplateManager />
    </div>
  )
}
