import { leerSpec } from "@/lib/plataforma-cliente"
import { upsertSpecProyectada } from "@/lib/plataforma-proyeccion-repo"
import type { TenantConfig } from "./tenants"

// Specs de la plataforma cuya proyección guarda el CRM. Una sola lista: la usa el receptor de
// eventos (qué instancias proyecta) y la sincronización inicial de specs (qué documentos baja).
export const SPECS_PROYECTADAS = ["atributos_tecnicos"] as const

export interface DepsSincronizarSpecs {
  leerSpec?: (t: TenantConfig, slug: string) => Promise<unknown>
  guardarSpec?: (tenantId: string, slug: string, version: number, document: Record<string, unknown>) => Promise<"escrita" | "vieja">
}

export type ResultadoSpec = { slug: string; resultado: "escrita" | "vieja" | "invalida" | "error"; version?: number; error?: string }

/**
 * GET inicial de los specs proyectados (el contrato pide que la app lea sus specs al arrancar) y
 * guardado en `catalog_specs`. Es el otro escritor (equivalente al receptor) de esa tabla; el
 * guardado ya rechaza versiones menores. Un spec que falla no corta a los demás.
 */
export async function sincronizarSpecs(t: TenantConfig, deps: DepsSincronizarSpecs = {}): Promise<ResultadoSpec[]> {
  const leer = deps.leerSpec ?? ((tt, slug) => leerSpec(tt, slug))
  const guardar = deps.guardarSpec ?? upsertSpecProyectada
  const out: ResultadoSpec[] = []
  for (const slug of SPECS_PROYECTADAS) {
    try {
      const doc = await leer(t, slug)
      const version = (doc as { version?: unknown } | null)?.version
      if (typeof doc !== "object" || doc === null || Array.isArray(doc) || typeof version !== "number") {
        out.push({ slug, resultado: "invalida" })
        continue
      }
      out.push({ slug, resultado: await guardar(t.id, slug, version, doc as Record<string, unknown>), version })
    } catch (err) {
      out.push({ slug, resultado: "error", error: err instanceof Error ? err.message : "error" })
    }
  }
  return out
}
