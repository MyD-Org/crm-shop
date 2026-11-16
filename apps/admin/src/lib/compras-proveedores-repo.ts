import { and, eq, ilike, or, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraContacts } from "@/db/schema"
import { searchContactsRaw } from "./alegra"
import { CUENTA_ALEGRA_PRINCIPAL } from "./alegra-contacts-repo"
import type { TenantConfig } from "./tenants"

// Buscador de proveedores de Compras (change `compras-en-transito`, S4): lee el espejo
// `alegra_contacts` de la cuenta elegida (los de tipo `provider`). Si el espejo de esa cuenta está
// vacío cae a una búsqueda EN VIVO (sólo lectura) y lo avisa.

export interface ProveedorDto {
  id: string
  nombre: string
  cuit: string | null
}

export interface ResultadoProveedores {
  proveedores: ProveedorDto[]
  /** true si salió de Alegra en vivo porque el espejo de la cuenta está vacío. */
  enVivo: boolean
}

const patron = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`

/** La cuenta de Alegra del espejo: la principal se guarda como 'principal'; las demás, por slug. */
export const cuentaDeEspejo = (slug: string, principal: boolean) => (principal ? CUENTA_ALEGRA_PRINCIPAL : slug)

export async function buscarProveedores(
  tenantId: string,
  cuenta: { slug: string; principal: boolean },
  q: string,
  vivo: (() => Promise<TenantConfig>) | null,
  limite = 20,
): Promise<ResultadoProveedores> {
  const db = getDb()
  const espejo = cuentaDeEspejo(cuenta.slug, cuenta.principal)
  const cond = [
    eq(alegraContacts.tenantId, tenantId),
    eq(alegraContacts.alegraAccount, espejo),
    sql`'provider' = ANY(${alegraContacts.types})`,
  ]
  const texto = q.trim()
  if (texto) cond.push(or(ilike(alegraContacts.name, patron(texto)), ilike(alegraContacts.identification, patron(texto)))!)
  const filas = await db
    .select({ id: alegraContacts.alegraId, name: alegraContacts.name, identification: alegraContacts.identification })
    .from(alegraContacts)
    .where(and(...cond))
    .orderBy(alegraContacts.name)
    .limit(limite)
  if (filas.length > 0 || !vivo) {
    return { proveedores: filas.map((f) => ({ id: f.id, nombre: f.name, cuit: f.identification })), enVivo: false }
  }
  // Sin resultados: ¿el espejo de la cuenta está vacío? Sólo entonces se consulta Alegra en vivo.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(alegraContacts)
    .where(and(eq(alegraContacts.tenantId, tenantId), eq(alegraContacts.alegraAccount, espejo)))
  if (n > 0 || !texto) return { proveedores: [], enVivo: false }
  const raw = await searchContactsRaw(await vivo(), texto, limite)
  const proveedores = raw
    .filter((c) => {
      const t = c.type
      return Array.isArray(t) ? t.includes("provider") : t === "provider"
    })
    .map((c) => {
      const ident = c.identification
      const cuit = typeof ident === "string" ? ident : ident && typeof ident === "object" ? String((ident as { number?: unknown }).number ?? "") : ""
      return { id: String(c.id), nombre: String(c.name ?? ""), cuit: cuit || null }
    })
  return { proveedores, enVivo: true }
}
