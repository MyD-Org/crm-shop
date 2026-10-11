// src/app/api/internal/marketing/solicitudes/route.ts
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { listarSolicitudes } from "@/lib/marketing/otros-repo"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const auth = autenticarInterno(req, ["planificador"])
  if (!auth.ok) return auth.response
  const estado = new URL(req.url).searchParams.get("estado") ?? "pendiente"
  if (estado !== "pendiente" && estado !== "resuelta" && estado !== "fallida") return jsonInterno({ error: "invalid_estado" }, 400)
  return jsonInterno({ items: await listarSolicitudes(auth.tenantId, estado) })
}
