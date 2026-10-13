import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { shopMediaConfig } from "@/lib/shop-media"
import { TiendaOnlineForm } from "@/components/admin/TiendaOnlineForm"

export const dynamic = "force-dynamic"

// Marca y direcciones de la tienda online de la empresa. Admin+ (operator → 404).
export default async function TiendaOnlinePage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok || roleRank(guard.user.role) < 1) notFound()

  const [tenant] = await getDb()
    .select({ marca: tenants.shopMarca, shopUrl: tenants.shopUrl, shopInternalUrl: tenants.shopInternalUrl })
    .from(tenants)
    .where(eq(tenants.id, guard.tenantId))
  if (!tenant) notFound()

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Tienda online</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          La marca que muestra la tienda y las direcciones a las que el CRM le avisa
        </p>
      </div>
      <TiendaOnlineForm initial={tenant} imagenesDisponibles={shopMediaConfig() !== null} />
    </div>
  )
}
