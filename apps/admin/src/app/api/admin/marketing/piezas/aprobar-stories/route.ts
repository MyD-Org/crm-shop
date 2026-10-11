import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { listarPiezas, transicionar } from "@/lib/marketing/piezas-repo"

export const dynamic = "force-dynamic"
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

// Aprobación en lote de las stories de una semana (spec: las stories se aprueban juntas).
export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const b = (await req.json().catch(() => null)) as { desde?: unknown; hasta?: unknown } | null
  if (!b || !FECHA_RE.test(String(b.desde)) || !FECHA_RE.test(String(b.hasta))) {
    return Response.json({ error: "Indique el rango de fechas", code: "invalid_rango" }, { status: 400, headers: NO_STORE })
  }
  const desde = new Date(`${b.desde}T00:00:00-03:00`)
  const hasta = new Date(`${b.hasta}T00:00:00-03:00`)
  if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) {
    return Response.json({ error: "Indique el rango de fechas", code: "invalid_rango" }, { status: 400, headers: NO_STORE })
  }
  const piezas = await listarPiezas(guard.tenantId, { estado: "para_revisar", desde, hasta })
  let aprobadas = 0
  for (const p of piezas.filter((x) => x.formato === "story")) {
    const r = await transicionar(guard.tenantId, p.id, "aprobada", "usuario", { nombreActor: guard.user.name, nota: "aprobación en lote" })
    if (r.ok) aprobadas++
  }
  return Response.json({ aprobadas }, { headers: NO_STORE })
}
