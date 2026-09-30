import { adminNotFoundResponse } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/sucursales-respuestas"
import type { ResultadoMedio } from "@/lib/medios-pago-shop-repo"

/** 400 validación, 409 conflicto (con `campo` cuando lo hay). */
export function errorDeMedio(r: Exclude<ResultadoMedio, { kind: "ok" }>): Response {
  if (r.kind === "not_found") return adminNotFoundResponse()
  if (r.kind === "invalid") {
    return Response.json({ error: r.error, code: "invalid", campo: r.campo }, { status: 400, headers: NO_STORE })
  }
  return Response.json({ error: r.error, code: "conflict", campo: r.campo }, { status: 409, headers: NO_STORE })
}
