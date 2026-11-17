import { eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { accesoSeccion } from "@/lib/secciones-acceso"
import { ADMIN_LIST_DEFAULT_LIMIT, listAdmin, toAdminDtos } from "@/lib/payment-receipts"
import { r2Config } from "@/lib/r2"
import { ComprobantesShell } from "@/components/admin/comprobantes/ComprobantesShell"

export const dynamic = "force-dynamic"

// Sección Comprobantes (`accesoSeccion`; sin ella, 404). El layout protegido ya corrió el guard y
// redirige si no hay sesión; acá se repite para la sección (la sesión pasa el guard del layout
// pero no alcanza para ver la feature) y para poder renderizar la página sola.
export default async function ComprobantesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const guard = await accesoSeccion("comprobantes")
  if (!guard) notFound()

  const sp = await searchParams
  const now = new Date()

  const [{ items, total }, [tenant]] = await Promise.all([
    // Primera página de Pendientes: el shell refetcha vía API al cambiar de tab/página/poll.
    listAdmin(guard.tenantId, { status: "pending" }, now),
    getDb()
      .select({ receiptsEmail: tenants.receiptsEmail })
      .from(tenants)
      .where(eq(tenants.id, guard.tenantId)),
  ])

  return (
    <div className="p-4 md:p-6">
      {/* pl-10 md:pl-0: en mobile corre el título para que no lo tape el botón ☰ del sidebar. */}
      <div className="mb-4 md:mb-6 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Comprobantes</h1>
        <p className="hidden md:block text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Pagos informados por los clientes desde el portal
        </p>
      </div>
      <ComprobantesShell
        initialItems={await toAdminDtos(guard.tenantId, items, now)}
        initialTotal={total}
        initialReceiptsEmailConfigured={(tenant?.receiptsEmail ?? "") !== ""}
        initialStorageConfigured={r2Config() !== null}
        initialOpenId={sp.id}
        pageSize={ADMIN_LIST_DEFAULT_LIMIT}
      />
    </div>
  )
}
