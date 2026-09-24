/**
 * `crm_token` del chat: el token con el que las tools del agente de ai-api
 * consultan `/api/agent/*` del CRM en nombre de un cliente VINCULADO. SOLO
 * servidor.
 *
 * Portado de apps/admin/src/lib/agent-token.ts (`mintAgentToken`): MISMO
 * formato (`<payload base64url>.<HMAC-SHA256 base64url>`), mismo payload
 * `{ c: codigocliente, t: tenant, e: vence (epoch ms) }`, mismo TTL (1 h) y
 * misma clave (`SESSION_SECRET`, compartida con el CRM igual que la cookie del
 * portal). El CRM lo verifica con su `verifyAgentToken` y exige que `t`
 * coincida con el tenant resuelto del request: por eso `t` es el
 * `SHOP_TENANT_ID` (el slug de `tenants.id` del CRM).
 *
 * El Shop sólo mintea; la verificación vive en el CRM. Si cambia el formato de
 * un lado hay que cambiarlo del otro (contrato `crm-ai-api` en MyD-Org/platform);
 * el test fija un vector generado con la función del CRM.
 */
import { createHmac } from "crypto";

export const AGENT_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Mismo mínimo que exige el CRM (session-secret.ts). */
const LARGO_MINIMO_SECRETO = 32;

export class SecretoAgenteFaltanteError extends Error {
  constructor() {
    super("Falta SESSION_SECRET (o es demasiado corto) para firmar el crm_token del chat.");
    this.name = "SecretoAgenteFaltanteError";
  }
}

function secreto(): string {
  const v = process.env.SESSION_SECRET;
  if (!v || v.length < LARGO_MINIMO_SECRETO) throw new SecretoAgenteFaltanteError();
  return v;
}

export function mintAgentToken(codigocliente: string, tenantId: string, ahora: number = Date.now()): string {
  const clave = secreto();
  const payload = Buffer.from(
    JSON.stringify({ c: codigocliente, t: tenantId, e: ahora + AGENT_TOKEN_TTL_MS }),
  ).toString("base64url");
  const firma = createHmac("sha256", clave).update(payload).digest("base64url");
  return `${payload}.${firma}`;
}
