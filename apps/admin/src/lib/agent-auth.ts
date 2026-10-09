import { verifyAgentToken } from "@/lib/agent-token"
import { bearerMatches, secureCompare } from "@/lib/secure-compare"

// Auth compartida de los endpoints /api/agent/*: Bearer token minteado en /api/ai-token.
//
// `tenantId` es el tenant resuelto del request (x-tenant-id / Host). El token trae el
// tenant al que fue minteado; si no coincide, se rechaza (evita reusar un token válido
// de un tenant contra otro — ver agent-token.ts). Devuelve solo el codigocliente al caller.
export function authAgentRequest(req: Request, tenantId: string): { codigocliente: string } | null {
  const header = req.headers.get("authorization") ?? ""
  if (!header.startsWith("Bearer ")) return null
  const auth = verifyAgentToken(header.slice(7))
  if (!auth) return null
  if (auth.tenantId !== tenantId) {
    console.warn(
      `[agent-auth] token/tenant mismatch: token=${auth.tenantId} request=${tenantId} — rechazado`,
    )
    return null
  }
  return { codigocliente: auth.codigocliente }
}

// Auth para endpoints /api/agent/* con datos PÚBLICOS del tenant (no de un cliente puntual):
// catálogo, precios, condiciones de pago, configuración comercial. Acepta dos credenciales:
//  - crm_token de un cliente (flujo web/widget logueado), atado al tenant, o
//  - INTERNAL_SECRET server-to-server (flujo de canales: WhatsApp/IG, donde no hay
//    un cliente logueado y el bot consulta info general en nombre del tenant).
// Devuelve el codigocliente si vino por crm_token, o "internal" si vino por la llave.
//
// El path INTERNAL_SECRET NO chequea tenant del token (no hay token): es un secreto
// server-to-server de confianza y el tenant se resuelve del Host igual. El path crm_token
// sí exige que el tenant del token coincida con `tenantId`.
//
// OJO: el crm_token NO es secreto frente al cliente que lo recibe. /api/ai-token lo manda a
// ai-api como claim de la sesión del widget, y ai-api lo devuelve DENTRO del JWT de sesión
// (HS256: firmado, no cifrado — ai-api `src/auth/session-tokens.ts`), que /api/ai-token
// reenvía al navegador. Cualquier cliente logueado puede decodificar ese JWT, sacar su
// crm_token y llamar a /api/agent/* por fuera del chat. Por eso esta función sólo protege
// rutas cuya respuesta el cliente podría ver igual en la tienda (datos del tenant que no
// identifican a terceros). Las rutas que operan sobre OTROS contactos del tenant (buscar o
// crear contactos, cotizar para un contact_id arbitrario) NO deben aceptar el crm_token:
// usan authAgentInternalRequest.
export function authAgentTenantRequest(req: Request, tenantId: string): { codigocliente: string } | null {
  const header = req.headers.get("authorization") ?? ""
  if (!header.startsWith("Bearer ")) return null
  const token = header.slice(7)

  const internal = process.env.INTERNAL_SECRET
  if (internal && secureCompare(token, internal)) return { codigocliente: "internal" }

  const auth = verifyAgentToken(token)
  if (!auth) return null
  if (auth.tenantId !== tenantId) {
    console.warn(
      `[agent-auth] token/tenant mismatch: token=${auth.tenantId} request=${tenantId} — rechazado`,
    )
    return null
  }
  return { codigocliente: auth.codigocliente }
}

// Auth para endpoints /api/agent/* que operan sobre CUALQUIER contacto del tenant
// (/api/agent/contacts, /api/agent/quotes): sólo INTERNAL_SECRET, server-to-server. Las tools
// de ai-api que pegan acá se configuran con `Authorization: Bearer {{auth.internal_secret}}`,
// nunca con `{{end_user.claims.crm_token}}`, porque el crm_token llega al navegador del
// cliente (ver authAgentTenantRequest) y con él podría buscar datos de otros clientes, dar de
// alta contactos en Alegra o cotizar a nombre de cualquiera. Un crm_token válido acá da null.
// El tenant se resuelve del Host como siempre; no hay token que atar.
export function authAgentInternalRequest(req: Request): { codigocliente: "internal" } | null {
  return bearerMatches(req.headers.get("authorization"), process.env.INTERNAL_SECRET)
    ? { codigocliente: "internal" }
    : null
}
