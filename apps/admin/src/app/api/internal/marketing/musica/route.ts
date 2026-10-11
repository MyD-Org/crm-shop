// src/app/api/internal/marketing/musica/route.ts
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { listarMusica } from "@/lib/marketing/otros-repo"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const auth = autenticarInterno(req, ["studio", "planificador"])
  if (!auth.ok) return auth.response
  return jsonInterno({ items: await listarMusica(auth.tenantId) })
}
