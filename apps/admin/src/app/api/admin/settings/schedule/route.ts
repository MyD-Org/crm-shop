import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { adminSessionOptions, type AdminSessionData } from "@/lib/admin-session"
import { parseSchedule, parseExceptions } from "@/lib/schedule"
import { roleRank } from "@/lib/roles"
import { guardarHorario, leerHorario, MSG_SUCURSAL_NO_EXISTE } from "@/lib/horarios-repo"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"
// notes ya no se carga a mano: el ai-api lo recibe generado a partir de las excepciones
// (ver exceptionsToNotes en el endpoint interno). Acá solo persistimos schedule + exceptions.
// Autorización: admin y superadmin (rank ≥ 1). El operator no puede tocar horarios.
//
// `?sucursal=<slug>` (change `horarios-por-sucursal`): lee/escribe el horario de esa sucursal del
// tenant de la sesión; sin el parámetro, el de la empresa (`tenants`). Un slug inexistente o de
// otro tenant responde 404 (nunca toca otro tenant).

async function getSession() {
  return getIronSession<AdminSessionData>(await cookies(), adminSessionOptions)
}

function canEditSchedule(role: string): boolean {
  return roleRank(role) >= 1
}

function slugDe(req: NextRequest): string | null {
  const v = req.nextUrl.searchParams.get("sucursal")
  return v && v.trim() ? v.trim() : null
}

const noExiste = () => NextResponse.json({ error: MSG_SUCURSAL_NO_EXISTE }, { status: 404 })

// GET /api/admin/settings/schedule[?sucursal=slug] → { schedule: WeeklySchedule, exceptions: ScheduleException[] }
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.userId) return NextResponse.json({ error: "no autorizado" }, { status: 401 })
  if (!canEditSchedule(session.role)) return NextResponse.json({ error: "prohibido" }, { status: 403 })

  const r = await leerHorario(session.tenantId, slugDe(req))
  if (r.kind === "not_found") return noExiste()
  return NextResponse.json({ schedule: r.schedule, exceptions: r.exceptions })
}

// PUT /api/admin/settings/schedule[?sucursal=slug]
// Body: { schedule: WeeklySchedule, exceptions?: ScheduleException[] }
//   schedule: franjas por día ("HH:MM"); día sin franjas = cerrado
//   exceptions: feriados/vacaciones (closed) u horario especial en una fecha (special)
export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session.userId) return NextResponse.json({ error: "no autorizado" }, { status: 401 })
  if (!canEditSchedule(session.role)) return NextResponse.json({ error: "prohibido" }, { status: 403 })

  const body = (await req.json()) as { schedule?: unknown; exceptions?: unknown }

  const parsed = parseSchedule(body.schedule)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const parsedEx = parseExceptions(body.exceptions)
  if (!parsedEx.ok) {
    return NextResponse.json({ error: parsedEx.error }, { status: 400 })
  }

  const slug = slugDe(req)
  const r = await guardarHorario(session.tenantId, slug, {
    schedule: parsed.schedule,
    exceptions: parsedEx.exceptions,
  })
  if (r.kind === "not_found") return noExiste()

  // El Shop muestra el horario de cada sucursal: se avisa DESPUÉS de persistir (nunca tira).
  if (slug) await pingShopRevalidarSucursales()

  return NextResponse.json({ ok: true, schedule: parsed.schedule, exceptions: parsedEx.exceptions })
}
