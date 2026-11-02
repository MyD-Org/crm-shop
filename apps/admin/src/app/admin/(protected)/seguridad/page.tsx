import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers } from "@/db/schema"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { SeguridadCuenta } from "@/components/admin/SeguridadCuenta"

export const dynamic = "force-dynamic"

// Verificación en dos pasos del propio usuario: estado y códigos de respaldo nuevos. Todos los roles.
export default async function SeguridadPage() {
  const guard = await getGuardedAdminSession()
  if (!guard.ok) notFound()

  const [u] = await getDb()
    .select({ totpEnabledAt: adminUsers.totpEnabledAt, totpRecoveryHashes: adminUsers.totpRecoveryHashes })
    .from(adminUsers)
    .where(eq(adminUsers.id, guard.user.id))

  return (
    <div className="p-4 md:p-6 max-w-xl">
      <SeguridadCuenta
        activadaEn={u?.totpEnabledAt?.toISOString() ?? null}
        restantes={u?.totpRecoveryHashes.length ?? 0}
      />
    </div>
  )
}
