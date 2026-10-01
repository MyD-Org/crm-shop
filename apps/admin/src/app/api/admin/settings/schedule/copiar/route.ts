import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { adminSessionOptions, type AdminSessionData } from "@/lib/admin-session"
import { roleRank } from "@/lib/roles"
import { copiarHorario, MSG_SUCURSAL_NO_EXISTE, QUE_COPIAR, type QueCopiar } from "@/lib/horarios-repo"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"

// POST /api/admin/settings/schedule/copiar  (change `horarios-por-sucursal`)
// Body: { desde: slug, hacia: slug[] | "todas", que: "excepciones" | "horario" | "todo" }
// Copia lo GUARDADO de la sucursal `desde` a las demás (sobrescribe lo copiado, en una
// transacción). Admin y superadmin. Un destino que no es del tenant → 404 y no se escribe nada.

async function getSession() {
  return getIronSession<AdminSessionData>(await cookies(), adminSessionOptions)
}

const invalido = (error: string) => NextResponse.json({ error }, { status: 400 })

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.userId) return NextResponse.json({ error: "no autorizado" }, { status: 401 })
  if (roleRank(session.role) < 1) return NextResponse.json({ error: "prohibido" }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return invalido("El cuerpo de la solicitud no es válido.")
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>

  if (typeof b.desde !== "string" || !b.desde.trim()) return invalido("Indique la sucursal de origen.")
  if (typeof b.que !== "string" || !QUE_COPIAR.includes(b.que as QueCopiar)) {
    return invalido("Indique qué copiar: excepciones, horario semanal o ambos.")
  }
  let hacia: string[] | "todas"
  if (b.hacia === "todas") {
    hacia = "todas"
  } else if (Array.isArray(b.hacia) && b.hacia.every((s) => typeof s === "string" && s.trim())) {
    hacia = (b.hacia as string[]).map((s) => s.trim())
  } else {
    return invalido("Indique las sucursales de destino.")
  }

  const r = await copiarHorario(session.tenantId, { desde: b.desde.trim(), hacia, que: b.que as QueCopiar })
  if (r.kind === "not_found") return NextResponse.json({ error: MSG_SUCURSAL_NO_EXISTE }, { status: 404 })
  if (r.kind === "invalid") return invalido(r.error)

  await pingShopRevalidarSucursales()
  return NextResponse.json({ ok: true, destinos: r.destinos })
}
