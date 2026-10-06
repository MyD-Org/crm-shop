import { listPriceLists, type AlegraPriceList } from "./alegra"
import { objetivosDeTenant, type ObjetivoSync } from "./alegra-contacts-objetivos"
import type { TenantConfig } from "./tenants"

// Listas de precio de Alegra que se pueden enlazar a una lista online privada (change
// `listas-cuenta-corriente`). Fuente: GET /price-lists de CADA cuenta del tenant. El id es el mismo
// que Alegra devuelve en `contact.priceList.id` (lo que se guarda en `alegra_contacts.price_list_id`
// y con lo que el Shop resuelve contacto -> lista -> mapeo): ambos son el id de la lista de precios
// de la cuenta, en texto. Los `idPriceList` de `catalog_products.raw` no se usan para esto.

export interface ListaAlegraSelector {
  alegraAccount: string
  cuentaNombre: string | null
  alegraPriceListId: string
  nombre: string
  /** Contactos activos del espejo con esa lista (0 = ninguno la tiene). */
  contactos: number
}

export interface ListaDerivada {
  alegraAccount: string
  alegraPriceListId: string
  nombre: string | null
  contactos: number
}

/**
 * Une las listas de la API (todas las de cada cuenta), las derivadas de los contactos (cantidad de
 * clientes, y respaldo si la API de esa cuenta falló) y los enlaces ya cargados (se conservan aunque
 * la lista ya no exista). `api[cuenta]` ausente = esa cuenta no se pudo leer.
 */
export function combinarListasAlegra(input: {
  derivadas: ListaDerivada[]
  enlaces: { alegraAccount: string; alegraPriceListId: string }[]
  api: Record<string, AlegraPriceList[]>
  nombresCuenta: Map<string, string>
}): ListaAlegraSelector[] {
  const out = new Map<string, ListaAlegraSelector>()
  const clave = (cuenta: string, id: string) => `${cuenta}\u0000${id}`
  const nuevo = (cuenta: string, id: string, nombre: string, contactos: number): ListaAlegraSelector => ({
    alegraAccount: cuenta,
    cuentaNombre: input.nombresCuenta.get(cuenta) ?? null,
    alegraPriceListId: id,
    nombre,
    contactos,
  })
  for (const d of input.derivadas) {
    out.set(clave(d.alegraAccount, d.alegraPriceListId), nuevo(d.alegraAccount, d.alegraPriceListId, d.nombre?.trim() || `Lista ${d.alegraPriceListId}`, d.contactos))
  }
  for (const [cuenta, listas] of Object.entries(input.api)) {
    for (const l of listas) {
      const derivada = out.get(clave(cuenta, l.alegraId))
      // El nombre de la API manda sobre el que quedó en el contacto.
      out.set(clave(cuenta, l.alegraId), nuevo(cuenta, l.alegraId, l.name.trim() || derivada?.nombre || `Lista ${l.alegraId}`, derivada?.contactos ?? 0))
    }
  }
  for (const e of input.enlaces) {
    const k = clave(e.alegraAccount, e.alegraPriceListId)
    if (!out.has(k)) out.set(k, nuevo(e.alegraAccount, e.alegraPriceListId, `Lista ${e.alegraPriceListId}`, 0))
  }
  return [...out.values()].sort(
    (a, b) => a.alegraAccount.localeCompare(b.alegraAccount) || a.alegraPriceListId.localeCompare(b.alegraPriceListId, undefined, { numeric: true }),
  )
}

// ── Lectura de la API, con caché ────────────────────────────────────────────────────────────────

/** Las listas de precio cambian poco; el caché evita pegarle a Alegra cada vez que se abre la pantalla. */
export const TTL_LISTAS_ALEGRA_MS = 10 * 60 * 1000

const cache = new Map<string, { vence: number; listas: AlegraPriceList[] }>()

export function vaciarCacheListasAlegra(): void {
  cache.clear()
}

export interface ListasDeAlegra {
  porCuenta: Record<string, AlegraPriceList[]>
  /** Cuentas cuyas listas no se pudieron leer (error de Alegra o sin credenciales). */
  cuentasFallidas: string[]
}

export async function leerListasDeAlegra(
  base: TenantConfig,
  deps: {
    objetivos?: (base: TenantConfig) => Promise<ObjetivoSync[]>
    listar?: (config: TenantConfig) => Promise<AlegraPriceList[]>
    ahora?: () => number
  } = {},
): Promise<ListasDeAlegra> {
  const objetivos = deps.objetivos ?? ((b: TenantConfig) => objetivosDeTenant(b, null))
  const listar = deps.listar ?? listPriceLists
  const ahora = deps.ahora ?? Date.now
  const porCuenta: Record<string, AlegraPriceList[]> = {}
  const cuentasFallidas: string[] = []
  let lista: ObjetivoSync[]
  try {
    lista = await objetivos(base)
  } catch {
    return { porCuenta, cuentasFallidas: ["principal"] }
  }
  await Promise.all(
    lista.map(async (o) => {
      if (!o.config) {
        cuentasFallidas.push(o.cuenta)
        return
      }
      const k = `${o.tenant}|${o.cuenta}`
      const hit = cache.get(k)
      if (hit && hit.vence > ahora()) {
        porCuenta[o.cuenta] = hit.listas
        return
      }
      try {
        const listas = await listar(o.config)
        cache.set(k, { vence: ahora() + TTL_LISTAS_ALEGRA_MS, listas })
        porCuenta[o.cuenta] = listas
      } catch (err) {
        // Sin datos sensibles en el log: solo el tipo de error.
        console.warn(`[listas-alegra] tenant=${o.tenant} cuenta=${o.cuenta} no se pudieron leer las listas: ${err instanceof Error ? err.name : "error"}`)
        cuentasFallidas.push(o.cuenta)
      }
    }),
  )
  return { porCuenta, cuentasFallidas }
}
