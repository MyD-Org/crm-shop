import { and, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { getDb } from "@/db"
import { adminUsers, adminPasswordTokens } from "@/db/schema"
import { accesoSeccion } from "@/lib/secciones-acceso"
import { UserList } from "@/components/admin/UserList"

export const dynamic = "force-dynamic"

export default async function UsuariosPage() {
  // Sección fija `usuarios` (admin+, la regla de `canManageUsers`). Rol, tenant e id del usuario
  // salen de la fila fresca, nunca de la cookie.
  const acceso = await accesoSeccion("usuarios")
  if (!acceso) notFound()

  const users = await getDb()
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      name: adminUsers.name,
      role: adminUsers.role,
      departments: adminUsers.departments,
      canalesPermitidos: adminUsers.canalesPermitidos,
      createdAt: adminUsers.createdAt,
      passwordHash: adminUsers.passwordHash,
      totpEnabledAt: adminUsers.totpEnabledAt,
      inviteExpiresAt: adminPasswordTokens.expiresAt,
      inviteAcceptedAt: adminPasswordTokens.usedAt,
    })
    .from(adminUsers)
    .leftJoin(
      adminPasswordTokens,
      and(eq(adminPasswordTokens.userId, adminUsers.id), eq(adminPasswordTokens.type, "invite")),
    )
    .where(eq(adminUsers.tenantId, acceso.tenantId))

  const userList = users.map(({ canalesPermitidos, totpEnabledAt, ...u }) => ({
    ...u,
    tiene2fa: !!totpEnabledAt,
    canales_permitidos: canalesPermitidos,
    hasPassword: !!u.passwordHash,
    passwordHash: undefined,
  }))

  return (
    <div className="p-4 md:p-6">
      <UserList initialUsers={userList} currentUserId={acceso.userId} currentRole={acceso.role} />
    </div>
  )
}
