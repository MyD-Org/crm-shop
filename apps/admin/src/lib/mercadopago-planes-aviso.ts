// Consulta a Mercado Pago de las cuotas CON INTERÉS por marca, sólo para el AVISO del admin (change
// `cuotas-en-el-formulario`, rebanada 6). Usa la clave PÚBLICA de la cuenta (no hay token de acceso en el
// admin) y NUNCA lanza: si la clave falta, MP no responde o devuelve algo ilegible, no hay dato y el
// admin sigue sin aviso. Las cuentas salen de `clavesPublicasMP()`, para que el día que haya una cuenta
// de Mercado Pago por sucursal (MDP/IGZ) cambie sólo esa función.

const URL_PLANES = "https://api.mercadopago.com/v1/payment_methods/installments"
const TIMEOUT_MS = 3000
const CACHE_MS = 5 * 60_000

/** Marcas principales contra las que se compara (ids de `payment_method_id` de Mercado Pago). */
export const MARCAS_DE_REFERENCIA_MP: readonly { id: string; nombre: string }[] = [
  { id: "visa", nombre: "Visa" },
  { id: "master", nombre: "Mastercard" },
  { id: "amex", nombre: "American Express" },
  { id: "naranja", nombre: "Naranja" },
  { id: "cabal", nombre: "Cabal" },
]

export interface ClavePublicaMP {
  cuentaId: string
  publicKey: string
}

export interface InteresMarcaMP {
  nombre: string
  /** Cantidades de cuotas (>= 2) que Mercado Pago cobra CON interés al cliente en esa marca. */
  cuotasConInteres: ReadonlySet<number>
}

export interface InteresMPCuenta {
  cuentaId: string
  marcas: InteresMarcaMP[]
}

/** Cuentas de Mercado Pago cuya clave pública conoce el admin. Hoy hay una sola: `MP_PUBLIC_KEY`. */
export function clavesPublicasMP(env: Record<string, string | undefined> = process.env): ClavePublicaMP[] {
  const publicKey = env.MP_PUBLIC_KEY?.trim()
  return publicKey ? [{ cuentaId: "principal", publicKey }] : []
}

/**
 * Cantidades de cuotas con interés (`installment_rate` > 0) de una respuesta de
 * `/v1/payment_methods/installments`. `null` si la respuesta no tiene la forma esperada. Un emisor que
 * cobre interés en una cantidad alcanza para contarla. Sólo crédito, sólo 2 cuotas o más.
 */
export function parsearCuotasConInteres(json: unknown): Set<number> | null {
  if (!Array.isArray(json) || json.length === 0) return null
  const conInteres = new Set<number>()
  let leidos = 0
  for (const metodo of json) {
    if (typeof metodo !== "object" || metodo === null) continue
    const m = metodo as { payment_type_id?: unknown; payer_costs?: unknown }
    if (!Array.isArray(m.payer_costs)) continue
    leidos++
    if (m.payment_type_id !== undefined && m.payment_type_id !== "credit_card") continue
    for (const costo of m.payer_costs) {
      const c = costo as { installments?: unknown; installment_rate?: unknown } | null
      const cuotas = Number(c?.installments)
      const tasa = Number(c?.installment_rate)
      if (Number.isInteger(cuotas) && cuotas >= 2 && Number.isFinite(tasa) && tasa > 0) conInteres.add(cuotas)
    }
  }
  return leidos > 0 ? conInteres : null
}

const cache = new Map<string, { hasta: number; valor: Set<number> }>()

export function vaciarCacheDeInteresMP(): void {
  cache.clear()
}

/** Cantidades con interés de una marca en una cuenta, o `null` si no se pudo saber. No lanza. */
export async function consultarCuotasConInteres(p: {
  publicKey: string
  paymentMethodId: string
  amount: number
}): Promise<Set<number> | null> {
  const clave = `${p.publicKey}|${p.paymentMethodId}|${p.amount}`
  const guardado = cache.get(clave)
  if (guardado && guardado.hasta > Date.now()) return guardado.valor
  try {
    const url = new URL(URL_PLANES)
    url.searchParams.set("public_key", p.publicKey)
    url.searchParams.set("payment_method_id", p.paymentMethodId)
    url.searchParams.set("amount", String(p.amount))
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" })
    if (!res.ok) return null
    const valor = parsearCuotasConInteres(await res.json())
    if (!valor) return null
    cache.set(clave, { hasta: Date.now() + CACHE_MS, valor })
    return valor
  } catch {
    return null
  }
}

/**
 * Cuotas con interés en Mercado Pago, por cuenta y marca principal, para un monto de referencia. Las
 * marcas que no respondieron se omiten; sin ninguna respuesta la cuenta no aparece.
 */
export async function consultarInteresDeReferencia(
  amount: number,
  cuentas: ClavePublicaMP[] = clavesPublicasMP(),
): Promise<InteresMPCuenta[]> {
  const porCuenta = await Promise.all(
    cuentas.map(async (cuenta): Promise<InteresMPCuenta> => {
      const respuestas = await Promise.all(
        MARCAS_DE_REFERENCIA_MP.map(async (marca) => ({
          nombre: marca.nombre,
          cuotasConInteres: await consultarCuotasConInteres({ publicKey: cuenta.publicKey, paymentMethodId: marca.id, amount }),
        })),
      )
      const marcas: InteresMarcaMP[] = []
      for (const r of respuestas) if (r.cuotasConInteres) marcas.push({ nombre: r.nombre, cuotasConInteres: r.cuotasConInteres })
      return { cuentaId: cuenta.cuentaId, marcas }
    }),
  )
  return porCuenta.filter((c) => c.marcas.length > 0)
}
