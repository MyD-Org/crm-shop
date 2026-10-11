// src/app/api/internal/marketing/interacciones/[id]/route.ts
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { actualizarInteraccion, obtenerInteraccion } from "@/lib/marketing/otros-repo"

export const dynamic = "force-dynamic"

// ai-api sólo marca como respondida una interacción que ya publicó (y que estaba aprobada).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = autenticarInterno(req, ["aiapi"])
  if (!auth.ok) return auth.response
  const b = (await req.json().catch(() => null)) as { accion?: unknown } | null
  if (b?.accion !== "marcar_respondida") return jsonInterno({ error: "invalid_accion" }, 400)
  const id = (await ctx.params).id
  const i = await actualizarInteraccion(auth.tenantId, id, "marcar_respondida")
  if (i) return jsonInterno(i)
  // null = no existe o el estado no admite la acción: se distingue para que ai-api no reintente en vano.
  const actual = await obtenerInteraccion(auth.tenantId, id)
  if (!actual) return jsonInterno({ error: "not_found" }, 404)
  // Idempotente: un reintento tras una respuesta perdida ve la fila ya respondida y no debe fallar.
  if (actual.estado === "respondida") return jsonInterno(actual)
  return jsonInterno({ error: "invalid_state" }, 409)
}
