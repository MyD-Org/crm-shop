// src/app/api/internal/marketing/marca/route.ts
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { obtenerMarca } from "@/lib/marketing/marca-repo"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const auth = autenticarInterno(req, ["studio", "planificador", "aiapi"])
  if (!auth.ok) return auth.response
  return jsonInterno(await obtenerMarca(auth.tenantId))
}
