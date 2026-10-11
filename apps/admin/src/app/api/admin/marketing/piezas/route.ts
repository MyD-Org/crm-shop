import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { pingStudio } from "@/lib/marketing/ping-studio"
import { crearPieza, liberarClaimsVencidos, listarPiezas } from "@/lib/marketing/piezas-repo"
import { validarNuevaPieza } from "@/lib/marketing/validar"

export const dynamic = "force-dynamic"

function fechaOpcional(valor: string | null): Date | undefined | "invalida" {
  if (!valor) return undefined
  const f = new Date(valor)
  return isNaN(f.getTime()) ? "invalida" : f
}

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const q = new URL(req.url).searchParams
  const desde = fechaOpcional(q.get("desde"))
  const hasta = fechaOpcional(q.get("hasta"))
  if (desde === "invalida" || hasta === "invalida") {
    return Response.json({ error: "Revise el rango de fechas", code: "invalid_rango" }, { status: 400, headers: NO_STORE })
  }
  await liberarClaimsVencidos(guard.tenantId)
  return Response.json({ items: await listarPiezas(guard.tenantId, { desde, hasta }) }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const v = b ? validarNuevaPieza(b) : { ok: false as const, error: "invalid_json" }
  if (!v.ok) return Response.json({ error: "Revise los datos de la pieza", code: v.error }, { status: 400, headers: NO_STORE })
  const pieza = await crearPieza(guard.tenantId, v.pieza, { tipo: "usuario", nombre: guard.user.name })
  if (pieza.estado === "borrador") await pingStudio()
  return Response.json(pieza, { status: 201, headers: NO_STORE })
}
