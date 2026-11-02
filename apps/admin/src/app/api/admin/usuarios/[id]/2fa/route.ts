import { NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers } from "@/db/schema"
import { requireOperatorPlus } from "@/lib/admin-route-guard"
import { canActOnRole, canManageUsers } from "@/lib/roles"
import { quitar2fa } from "@/lib/admin-2fa"

/**
 * DELETE /api/admin/usuarios/[id]/2fa — restablece la verificación en dos pasos de otro usuario
 * (perdió el celular y los códigos de respaldo). Cierra sus sesiones; en el próximo login vuelve
 * a darla de alta con un QR nuevo. Mismos permisos que eliminar al usuario. Sobre uno mismo no:
 * con una sesión robada alguien podría cambiar el 2FA por el suyo.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response
  if (!canManageUsers(guard.user.role)) {
    return NextResponse.json({ error: "No tiene permisos de gestión de usuarios" }, { status: 403 })
  }

  const { id } = await params
  if (id === guard.user.id) {
    return NextResponse.json(
      { error: "No puede restablecer su propia verificación. Pídaselo a otro administrador." },
      { status: 400 },
    )
  }

  const [target] = await getDb()
    .select({ id: adminUsers.id, role: adminUsers.role, name: adminUsers.name })
    .from(adminUsers)
    .where(and(eq(adminUsers.id, id), eq(adminUsers.tenantId, guard.tenantId)))
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
  if (!canActOnRole(guard.user.role, target.role)) {
    return NextResponse.json({ error: "No tiene permisos sobre este usuario" }, { status: 403 })
  }

  await quitar2fa(target.id)
  console.warn(`[admin-2fa] ${guard.user.email} restableció el 2FA de ${target.id}`)
  return NextResponse.json({ ok: true })
}
