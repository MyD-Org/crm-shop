import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers } from "@/db/schema"
import { adminSessionOptions, type AdminSessionData } from "@/lib/admin-session"
import { requireOperatorPlus } from "@/lib/admin-route-guard"
import { assignableRoles, canActOnRole, canManageUsers } from "@/lib/roles"
import { parseCanalesPermitidos } from "@/lib/canal-acceso"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "body requerido" }, { status: 400 })

  const db = getDb()
  const [target] = await db
    .select()
    .from(adminUsers)
    .where(and(eq(adminUsers.id, id), eq(adminUsers.tenantId, guard.tenantId)))
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })

  // Editar a OTRO requiere poder gestionar usuarios y tener autoridad sobre el rol del target
  // (un admin puede tocar operadores, no otros admins ni al superadmin). El auto-edit (nombre
  // propio) lo puede hacer cualquiera.
  const isSelf = id === guard.user.id
  if (!isSelf && (!canManageUsers(guard.user.role) || !canActOnRole(guard.user.role, target.role))) {
    return NextResponse.json({ error: "No tiene permisos sobre este usuario" }, { status: 403 })
  }

  // Los canales del inbox los fija solo quien gestiona usuarios y sobre OTRO usuario: nadie se
  // amplía ni se recorta su propio acceso (el operador, ni el admin sobre sí mismo).
  const tocaCanales = Object.hasOwn(body, "canales_permitidos")
  if (tocaCanales && (isSelf || !canManageUsers(guard.user.role))) {
    return NextResponse.json({ error: "No tiene permisos para cambiar los canales de este usuario" }, { status: 403 })
  }

  const updates: Partial<typeof adminUsers.$inferInsert> = {}
  if (body.name && typeof body.name === "string") updates.name = body.name.trim()
  // Rol y departamentos: solo al gestionar a otro (no a uno mismo). El rol a asignar debe estar
  // dentro de lo que el actor puede otorgar (un admin no puede promover a admin/superadmin).
  if (!isSelf && canManageUsers(guard.user.role)) {
    if (body.role) {
      if (!assignableRoles(guard.user.role).includes(body.role)) {
        return NextResponse.json({ error: "No puede asignar ese rol" }, { status: 403 })
      }
      updates.role = body.role
    }
    if (Array.isArray(body.departments)) {
      updates.departments = body.departments.map((d: unknown) => String(d).trim()).filter(Boolean)
    }
    // Canales del inbox (null = todos, [] = ninguno, lista = solo esos). Solo para operadores:
    // admin y superadmin son siempre irrestrictos, así que un valor guardado no tendría efecto
    // y confundiría. Si el rol cambia a uno no restringible, la lista se limpia (NULL) para que
    // no reaparezca si después vuelve a ser operador.
    const rolFinal = updates.role ?? target.role
    if (tocaCanales) {
      const parsed = parseCanalesPermitidos(body.canales_permitidos)
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      if (parsed.value !== null && rolFinal !== "operator") {
        return NextResponse.json({ error: "Solo los operadores pueden tener canales restringidos." }, { status: 400 })
      }
      updates.canalesPermitidos = parsed.value
    }
    if (rolFinal !== "operator" && target.canalesPermitidos !== null) updates.canalesPermitidos = null
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "Sin campos para actualizar" }, { status: 400 })
  }

  const [updated] = await db.update(adminUsers).set(updates).where(eq(adminUsers.id, id)).returning()

  // Si el usuario editó su propio nombre, actualizar la sesión para que se refleje de inmediato
  if (isSelf && updates.name) {
    // La cookie guarda el nombre para la UI; el guard no la expone, así que se refresca aparte.
    const session = await getIronSession<AdminSessionData>(await cookies(), adminSessionOptions)
    session.name = updated.name
    await session.save()
  }

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    role: updated.role,
    departments: updated.departments,
    canales_permitidos: updated.canalesPermitidos,
  })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response
  if (!canManageUsers(guard.user.role)) return NextResponse.json({ error: "No tiene permisos de gestión de usuarios" }, { status: 403 })

  const { id } = await params
  if (id === guard.user.id) return NextResponse.json({ error: "No puede eliminarse a usted mismo" }, { status: 400 })

  const db = getDb()
  const [target] = await db
    .select()
    .from(adminUsers)
    .where(and(eq(adminUsers.id, id), eq(adminUsers.tenantId, guard.tenantId)))
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })

  // Un admin solo puede eliminar operadores; al superadmin y a otros admins, solo el superadmin.
  if (!canActOnRole(guard.user.role, target.role)) {
    return NextResponse.json({ error: "No tiene permisos sobre este usuario" }, { status: 403 })
  }

  await db.delete(adminUsers).where(eq(adminUsers.id, id))
  return NextResponse.json({ ok: true })
}
