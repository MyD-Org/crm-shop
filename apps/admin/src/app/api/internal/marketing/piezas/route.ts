// src/app/api/internal/marketing/piezas/route.ts
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { esEstadoPieza } from "@/lib/marketing/estados"
import { pingStudio } from "@/lib/marketing/ping-studio"
import { crearPieza, liberarClaimsVencidos, listarPiezas } from "@/lib/marketing/piezas-repo"
import { validarNuevaPieza } from "@/lib/marketing/validar"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const auth = autenticarInterno(req, ["studio", "planificador", "aiapi"])
  if (!auth.ok) return auth.response
  const q = new URL(req.url).searchParams
  const estado = q.get("estado") ?? undefined
  if (estado && !esEstadoPieza(estado)) return jsonInterno({ error: "invalid_estado" }, 400)
  const desde = q.get("desde") ? new Date(q.get("desde")!) : undefined
  const hasta = q.get("hasta") ? new Date(q.get("hasta")!) : undefined
  if ((desde && isNaN(desde.getTime())) || (hasta && isNaN(hasta.getTime()))) return jsonInterno({ error: "invalid_fecha" }, 400)
  await liberarClaimsVencidos(auth.tenantId)
  const items = await listarPiezas(auth.tenantId, { estado: estado as never, canal: q.get("canal") ?? undefined, desde, hasta })
  return jsonInterno({ items })
}

export async function POST(req: Request) {
  const auth = autenticarInterno(req, ["planificador"])
  if (!auth.ok) return auth.response
  const cuerpo = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!cuerpo) return jsonInterno({ error: "invalid_json" }, 400)
  const v = validarNuevaPieza(cuerpo)
  if (!v.ok) return jsonInterno({ error: v.error }, 400)
  const pieza = await crearPieza(auth.tenantId, v.pieza, { tipo: "planificador", nombre: "rutina" })
  if (pieza.estado === "borrador") await pingStudio()
  return jsonInterno(pieza, 201)
}
