// src/lib/marketing/auth-interna.ts
// Clientes de la API interna de marketing. Cada uno tiene SU secreto (patrón SHOP_CRM_SECRET de
// cuotas/v2): no se reutiliza INTERNAL_SECRET, que abre rutas de ai-api. El tenant sale del
// entorno (MARKETING_TENANT_ID), nunca del request. Con multi-tenant real, el mapa secreto →
// tenant pasa a una tabla.
import { bearerMatches } from "@/lib/secure-compare"

export type ClienteInterno = "studio" | "planificador" | "aiapi"

const SECRETO_DE: Record<ClienteInterno, string> = {
  studio: "MARKETING_STUDIO_SECRET",
  planificador: "MARKETING_PLANNER_SECRET",
  aiapi: "MARKETING_AIAPI_SECRET",
}

const NO_STORE = { "Cache-Control": "no-store" }

export function jsonInterno(cuerpo: unknown, status = 200): Response {
  return Response.json(cuerpo, { status, headers: NO_STORE })
}

export function autenticarInterno(
  req: Request,
  permitidos: ClienteInterno[],
): { ok: true; cliente: ClienteInterno; tenantId: string } | { ok: false; response: Response } {
  const auth = req.headers.get("authorization")
  const cliente = (Object.keys(SECRETO_DE) as ClienteInterno[]).find((c) => bearerMatches(auth, process.env[SECRETO_DE[c]]))
  if (!cliente) return { ok: false, response: jsonInterno({ error: "unauthorized" }, 401) }
  if (!permitidos.includes(cliente)) return { ok: false, response: jsonInterno({ error: "forbidden" }, 403) }
  const tenantId = process.env.MARKETING_TENANT_ID?.trim()
  if (!tenantId) return { ok: false, response: jsonInterno({ error: "not_configured" }, 503) }
  return { ok: true, cliente, tenantId }
}
