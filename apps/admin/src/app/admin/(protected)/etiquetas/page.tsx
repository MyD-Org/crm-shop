import { notFound } from "next/navigation"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { EtiquetasClient } from "./EtiquetasClient"

export const dynamic = "force-dynamic"

// Etiquetas: impresión por WebUSB desde el navegador (código de barras 29x20 y QR 6 por hoja).
// Admin+ (operator → 404). Los datos llegan por /api/admin/etiquetas/contexto y el listado del
// catálogo; el TSPL se arma y se envía en el navegador.
export default async function EtiquetasPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Etiquetas</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Impresión de etiquetas por USB desde este navegador
        </p>
      </div>
      <EtiquetasClient />
    </div>
  )
}
