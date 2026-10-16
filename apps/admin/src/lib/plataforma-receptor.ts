import { createHmac, timingSafeEqual } from "node:crypto"
import { registrarEntrega, upsertProyeccion, upsertSpecProyectada } from "@/lib/plataforma-proyeccion-repo"

// Receptor de eventos de la plataforma (contrato platform-apps/v1, "Recibir eventos"). Verifica la
// firma sobre el body crudo, es idempotente por X-Platform-Delivery y resuelve el desorden con
// "gana payload.instance.updated_at mayor" (nunca occurred_at).

export interface EventDocument {
  id: string; account_id: string; source: string; action: string; resource: string;
  actor: string | null; occurred_at: string; version: number; payload: unknown
}

export function firmaValida(secret: string, bodyCrudo: string, header: string | null): boolean {
  if (!secret || !header) return false
  const esperada = "sha256=" + createHmac("sha256", secret).update(bodyCrudo).digest("hex")
  const a = Buffer.from(header), b = Buffer.from(esperada)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Las specs cuya proyección el CRM guarda. Otras acciones se registran como entrega y se ignoran. */
const SPECS_PROYECTADAS = new Set(["atributos_tecnicos"])

interface InstanciaPayload { id: string; spec: string; spec_version: number; external_key: string; data: Record<string, unknown>; anchors: Record<string, string>; updated_at: string }

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * La vista catalog_atributos_shop hace jsonb_each(data) y (value->>'n')::numeric: una sola fila
 * malformada rompe la vista para todo el Shop. Devuelve la primera clave ofensora (o null si la
 * forma es válida). `fuentes` se deja pasar sin tocar.
 */
function claveInvalida(data: unknown): string | null {
  if (!esObjeto(data)) return "(data)"
  for (const [k, v] of Object.entries(data)) {
    if (k === "fuentes") continue
    if (!esObjeto(v)) return k
    const { n, t } = v
    if (n != null && !(typeof n === "number" && Number.isFinite(n))) return k
    if (t != null && typeof t !== "string") return k
  }
  return null
}

export async function procesarEvento(tenantId: string, deliveryId: string, ev: EventDocument): Promise<"procesado" | "repetido" | "ignorado" | "viejo"> {
  if (!(await registrarEntrega(tenantId, deliveryId, ev.id, ev.action))) return "repetido"
  const [slug, verbo] = ev.action.split(":")
  if (slug === "spec" && verbo === "update") {
    const p = ev.payload as { slug?: string; spec?: { version?: number } & Record<string, unknown> }
    if (!p?.slug || !p.spec || typeof p.spec.version !== "number") return "ignorado"
    await upsertSpecProyectada(tenantId, p.slug, p.spec.version, p.spec)
    return "procesado"
  }
  if (!SPECS_PROYECTADAS.has(slug) || (verbo !== "create" && verbo !== "update")) return "ignorado"
  const inst = (ev.payload as { instance?: InstanciaPayload })?.instance
  if (!inst?.external_key || !inst.updated_at) return "ignorado"
  const actualizado = new Date(inst.updated_at)
  const mala = claveInvalida(inst.data)
  if (mala !== null || Number.isNaN(actualizado.getTime())) {
    console.warn(`[plataforma] evento ignorado por forma inválida tenant=${tenantId} external_key=${inst.external_key} clave=${mala ?? "(updated_at)"}`)
    return "ignorado"
  }
  const r = await upsertProyeccion(tenantId, slug, inst.external_key, inst.id, inst.data, actualizado)
  return r === "escrita" ? "procesado" : "viejo"
}
