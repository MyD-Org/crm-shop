import type { TenantConfig } from "./tenants"

// Cliente del catálogo de la plataforma (contrato platform-apps/v1). Un solo lugar para la URL,
// el Bearer, el timeout y la traducción de errores; los módulos de negocio no hacen fetch.
export const TIMEOUT_MS = 15_000

/** Error de la plataforma. `status` 0 = fallo de red (no llegó respuesta). */
export class PlataformaError extends Error {
  status: number
  code: string
  details: string[]
  reintentable: boolean

  constructor(status: number, code: string, details: string[] = [], reintentable = false) {
    super(`plataforma ${status} ${code}${details.length ? `: ${details.join("; ")}` : ""}`)
    this.name = "PlataformaError"
    this.status = status
    this.code = code
    this.details = details
    this.reintentable = reintentable
  }
}

export interface BodyUpsert {
  data: Record<string, unknown>
  meta?: Record<string, unknown>
  anchors?: Record<string, string>
}

export interface Deps {
  fetch?: typeof fetch
  /** Timeout por llamada; por defecto TIMEOUT_MS. Los escritores de atributos usan uno más corto. */
  timeoutMs?: number
}

const base = (t: TenantConfig) => t.plataformaUrl.replace(/\/$/, "")

async function llamar(t: TenantConfig, path: string, init: RequestInit, deps: Deps): Promise<unknown> {
  const f = deps.fetch ?? fetch
  let res: Response
  try {
    res = await f(`${base(t)}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${t.plataformaApiKey}`,
        "content-type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
      cache: "no-store",
    })
  } catch (err) {
    throw new PlataformaError(0, "red", [err instanceof Error ? err.message : "error"], true)
  }
  const cuerpo = await res.json().catch(() => ({}))
  if (!res.ok) {
    const c = cuerpo as { error?: string; details?: string[] }
    const reintentable = res.status >= 500 || res.status === 408 || res.status === 429
    throw new PlataformaError(res.status, c.error ?? `http_${res.status}`, c.details ?? [], reintentable)
  }
  return cuerpo
}

/** Upsert por clave de una instancia de un spec. `created`/`changed` vienen de la plataforma. */
export async function upsertInstancia(
  t: TenantConfig,
  spec: string,
  clave: string,
  body: BodyUpsert,
  deps: Deps = {},
): Promise<{ created: boolean; changed: boolean }> {
  const path = `/platform/catalog/instances/${encodeURIComponent(spec)}/by-key/${encodeURIComponent(clave)}?upsert=true`
  const r = (await llamar(t, path, { method: "PATCH", body: JSON.stringify(body) }, deps)) as {
    created: boolean
    changed: boolean
  }
  return { created: Boolean(r.created), changed: Boolean(r.changed) }
}

/** Documento de un spec del catálogo. */
export async function leerSpec(t: TenantConfig, slug: string, deps: Deps = {}): Promise<unknown> {
  const r = (await llamar(t, `/platform/catalog/specs/${encodeURIComponent(slug)}`, { method: "GET" }, deps)) as {
    spec: unknown
  }
  return r.spec
}

/** Eventos de la plataforma desde `since` (tope 500 por llamada). */
export async function listarEventos(t: TenantConfig, since: Date, deps: Deps = {}): Promise<unknown[]> {
  const path = `/platform/events?since=${encodeURIComponent(since.toISOString())}&limit=500`
  const r = (await llamar(t, path, { method: "GET" }, deps)) as { events: unknown[] }
  return r.events ?? []
}
