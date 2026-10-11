// Resultado del chequeo de marca con IA que hace la rutina sobre una pieza en `para_revisar`.
// No cambia el estado: sólo reemplaza las alertas de fuente "ia".
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { obtenerPieza, registrarChequeoIa } from "@/lib/marketing/piezas-repo"
import { validarAlertasIa } from "@/lib/marketing/validar"

export const dynamic = "force-dynamic"

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = autenticarInterno(req, ["planificador"])
  if (!auth.ok) return auth.response
  const { id } = await ctx.params
  const b = (await req.json().catch(() => null)) as { alertas?: unknown } | null
  const v = validarAlertasIa(b?.alertas)
  if (!v.ok) return jsonInterno({ error: v.error }, 400)
  if (!(await obtenerPieza(auth.tenantId, id))) return jsonInterno({ error: "not_found" }, 404)
  const pieza = await registrarChequeoIa(auth.tenantId, id, v.alertas)
  return pieza ? jsonInterno(pieza) : jsonInterno({ error: "not_reviewable" }, 409)
}
