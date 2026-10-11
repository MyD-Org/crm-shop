// src/app/api/internal/marketing/material/route.ts
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { listarMaterial } from "@/lib/marketing/otros-repo"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const auth = autenticarInterno(req, ["studio", "planificador"])
  if (!auth.ok) return auth.response
  const piezaId = new URL(req.url).searchParams.get("pieza_id")
  if (!piezaId) return jsonInterno({ error: "missing_pieza_id" }, 400)
  return jsonInterno({ items: await listarMaterial(auth.tenantId, piezaId) })
}
