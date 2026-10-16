import { NextResponse } from "next/server"
import { bearerMatches } from "@/lib/secure-compare"
import { getTenantByIdFromDb, getTenantRegistry, plataformaConfigurada, type TenantConfig } from "@/lib/tenants"
import { empujarProductos } from "@/lib/plataforma-productos"

// Cron (GitHub Actions cada 15 min, como alegra-stock-drenar): empuja a la plataforma los
// productos que la sync tocó desde el último cursor. Idempotente: la plataforma converge por
// clave. Sin `?tenant=` recorre todos los tenants con la plataforma configurada.
export const maxDuration = 300
const MAX_LOTES = 20
/** Presupuesto total de la corrida (todos los tenants y lotes), por debajo de maxDuration: pasado esto no se lanzan lotes ni tenants nuevos. */
const DEADLINE_MS = 240_000

type ResultadoTenant = { tenant: string; ok: boolean; enviados: number; fallidos: number; lotes: number; error?: string; corte?: "deadline" }

async function correrTenant(t: TenantConfig, vencido: () => boolean): Promise<ResultadoTenant> {
  let enviados = 0, fallidos = 0, lotes = 0
  try {
    for (; lotes < MAX_LOTES; lotes++) {
      if (vencido()) {
        // Sin error: lo que falta lo retoma la próxima corrida desde el cursor.
        console.warn(`[plataforma] productos tenant=${t.id} corte por deadline lotes=${lotes}`)
        return { tenant: t.id, ok: true, enviados, fallidos, lotes, corte: "deadline" }
      }
      const r = await empujarProductos(t)
      enviados += r.enviados; fallidos += r.fallidos
      // Corte por red/5xx: se reintenta en la próxima corrida y se informa como falla del tenant.
      if (r.cortado) return { tenant: t.id, ok: false, enviados, fallidos, lotes: lotes + 1, error: "plataforma no disponible o configuración inválida" }
      if (r.enviados + r.fallidos === 0) break
    }
    console.log(`[plataforma] productos tenant=${t.id} enviados=${enviados} fallidos=${fallidos} lotes=${lotes}`)
    return { tenant: t.id, ok: true, enviados, fallidos, lotes }
  } catch (err) {
    const error = err instanceof Error ? err.message : "error"
    console.error(`[plataforma] productos tenant=${t.id} error=${error}`)
    return { tenant: t.id, ok: false, enviados, fallidos, lotes, error }
  }
}

export async function POST(req: Request) {
  const limite = Date.now() + DEADLINE_MS
  const vencido = () => Date.now() >= limite
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const solo = new URL(req.url).searchParams.get("tenant")?.trim() || null
  const ids = solo ? [solo] : [...(await getTenantRegistry()).ids].sort()
  const tenants: ResultadoTenant[] = []
  let corte: "deadline" | undefined
  for (const id of ids) {
    if (vencido()) { corte = "deadline"; break }
    let cfg: TenantConfig | null = null
    try { cfg = await getTenantByIdFromDb(id) } catch (err) {
      tenants.push({ tenant: id, ok: false, enviados: 0, fallidos: 0, lotes: 0, error: err instanceof Error ? err.message : "error" })
      continue
    }
    if (!cfg || !plataformaConfigurada(cfg)) continue
    const r = await correrTenant(cfg, vencido)
    tenants.push(r)
    if (r.corte) corte = "deadline"
  }
  return NextResponse.json({ ok: tenants.every((x) => x.ok), tenants, ...(corte ? { corte } : {}) })
}
export const GET = POST
