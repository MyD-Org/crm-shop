import { and, asc, eq, or, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraContacts } from "@/db/schema"
import type { TenantConfig } from "./tenants"
import {
  createContactRaw,
  esCliente,
  findContactRawByIdentifier,
  getContactRaw,
  mapRawContactRow,
  normalizePhone,
  searchContactsRaw,
  type AlegraContact,
  type AlegraContactInput,
  type FilaContactoAlegra,
} from "./alegra"
import { CUENTA_ALEGRA_PRINCIPAL, upsertContactos, type ContactoEspejoRow } from "./alegra-contacts-repo"

// Fachada de lectura de contactos del CRM: TODO lo que el CRM necesita saber de un contacto de
// Alegra (portal, bot, notificaciones) pasa por acá. La regla es una sola:
//
//   espejo primero (tabla alegra_contacts); si no hay fila activa, UNA consulta en vivo
//   acotada (nunca el padrón) y upsert de lo que trajo.
//
// Por qué: `/contacts` de Alegra admite ~5 requests por minuto por cuenta y responde 400 con
// {"code":429} cuando se pasa. El padrón completo lo recorre SOLO la sync
// (lib/alegra-contacts-sync.ts), por tramos; lo mantienen al día los webhooks de Alegra
// (lib/alegra-contacts-webhook.ts). Ninguna lectura de usuario puede recorrerlo.
//
// | Lectura               | Espejo                                        | Sin fila activa           |
// |-----------------------|-----------------------------------------------|---------------------------|
// | contactoPorId         | (tenant, cuenta, alegra_id)                   | GET /contacts/{id} (1)    |
// | contactoPorDocumento  | identification_norm = dígitos                 | findContactRaw… (≤4)      |
// | buscarPorTexto        | unaccent(name) ILIKE · identification_norm    | ?query= (1), solo si 0    |
// | buscarPorTelefono     | phones_norm @> [tel]                          | ninguno (sería el padrón) |
// | clientesActivos       | status y alegra_status activos                | ninguno                   |
// | crearContacto         | —                                             | POST /contacts + upsert   |
//
// Una fila `status='inactive'` cuenta como "no está": dispara el fallback (y si el contacto
// existe, el upsert la reactiva). `tipoCuenta` sale SIEMPRE de la columna generada
// `tipo_cuenta`, nunca se recalcula acá.

export { CUENTA_ALEGRA_PRINCIPAL }

/** Contacto leído del espejo: la forma de siempre + lo que solo el espejo sabe. */
export interface ContactoEspejo extends AlegraContact {
  tipoCuenta: "corriente" | "contado"
  types: string[]
  priceListStatus: string | null
  syncedAt: Date
}

type CamposContacto = Pick<
  FilaContactoAlegra,
  | "alegraId"
  | "name"
  | "identification"
  | "email"
  | "phonePrimary"
  | "mobile"
  | "priceListId"
  | "sellerId"
  | "paymentTermId"
  | "alegraStatus"
  | "paymentTermName"
  | "paymentTermDays"
  | "priceListName"
  | "sellerName"
  | "creditLimit"
>

/** Misma forma que devolvía `mapRawContact` (alegra.ts) leyendo en vivo. */
function contactoDeCampos(f: CamposContacto): AlegraContact {
  return {
    alegraId: f.alegraId,
    name: f.name,
    identification: f.identification,
    email: f.email,
    // Igual que en vivo: el principal y, si no hay, el celular.
    phone: f.phonePrimary ?? f.mobile ?? null,
    priceListId: f.priceListId,
    sellerId: f.sellerId,
    paymentTermId: f.paymentTermId,
    status: f.alegraStatus ?? "active",
    paymentTermName: f.paymentTermName,
    paymentTermDays: f.paymentTermDays,
    priceListName: f.priceListName,
    sellerName: f.sellerName,
    creditLimit: f.creditLimit != null ? Number(f.creditLimit) : null,
  }
}

export function contactoDeFila(row: ContactoEspejoRow): ContactoEspejo {
  return {
    ...contactoDeCampos(row),
    tipoCuenta: row.tipoCuenta === "corriente" ? "corriente" : "contado",
    types: row.types ?? [],
    priceListStatus: row.priceListStatus,
    syncedAt: row.syncedAt,
  }
}

/** Filtro base: el tenant, su cuenta principal y solo filas activas. */
function activasDel(config: TenantConfig) {
  return and(
    eq(alegraContacts.tenantId, config.id),
    eq(alegraContacts.alegraAccount, CUENTA_ALEGRA_PRINCIPAL),
    eq(alegraContacts.status, "active"),
  )
}

/** Upsert de lo que trajo el fallback en vivo y la fila resultante como ContactoEspejo. */
async function guardarFallback(config: TenantConfig, raws: Record<string, unknown>[]): Promise<ContactoEspejo[]> {
  if (raws.length === 0) return []
  const rows = await upsertContactos(config.id, raws.map(mapRawContactRow), "fallback")
  return rows.map(contactoDeFila)
}

/**
 * Contacto por id de Alegra (= `codigocliente` del portal). Sin fila activa: 1 request.
 * `null` = no existe en Alegra (404). Un error de Alegra (429 incluido) se propaga.
 */
export async function contactoPorId(config: TenantConfig, alegraId: string): Promise<ContactoEspejo | null> {
  const [row] = await getDb()
    .select()
    .from(alegraContacts)
    .where(and(activasDel(config), eq(alegraContacts.alegraId, alegraId)))
    .limit(1)
  if (row) return contactoDeFila(row)

  const raw = await getContactRaw(config, alegraId)
  if (!raw) return null
  const [c] = await guardarFallback(config, [raw])
  return c ?? null
}

/**
 * Contacto por CUIT, CUIL o DNI (solo dígitos), para el login del portal. Si hay más de uno
 * con el mismo documento, gana el que es cliente y después el id numérico menor: siempre el
 * mismo. Sin fila: las mismas consultas acotadas de siempre (≤4 requests, un 429 corta).
 */
export async function contactoPorDocumento(config: TenantConfig, digitos: string): Promise<ContactoEspejo | null> {
  const doc = digitos.replace(/\D/g, "")
  if (!doc) return null

  const rows = await getDb()
    .select()
    .from(alegraContacts)
    .where(and(activasDel(config), eq(alegraContacts.identificationNorm, doc)))
    .orderBy(
      sql`('client' = ANY(${alegraContacts.types})) DESC`,
      sql`CASE WHEN ${alegraContacts.alegraId} ~ '^[0-9]+$' THEN ${alegraContacts.alegraId}::numeric END ASC NULLS LAST`,
      asc(alegraContacts.alegraId),
    )
  if (rows.length > 1) {
    // Solo el conteo: el documento es un dato personal.
    console.warn(`[contactos] tenant=${config.id} documento repetido en ${rows.length} contactos; se usa el primero`)
  }
  if (rows[0]) return contactoDeFila(rows[0])

  const raw = await findContactRawByIdentifier(config, doc)
  if (!raw) return null
  const [c] = await guardarFallback(config, [raw])
  return c ?? null
}

/** Escapa los comodines de LIKE para que `q` se busque literal. */
function literalLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => `\\${m}`)
}

/**
 * Búsqueda por nombre (sin tildes) o por documento exacto (si `q` trae al menos 6 dígitos),
 * para el bot. Sin resultados en el espejo: 1 request a `?query=` (evita que el bot cree un
 * duplicado de un contacto que la sucursal acaba de cargar y el espejo todavía no vio).
 */
export async function buscarPorTexto(config: TenantConfig, q: string, limit = 20): Promise<ContactoEspejo[]> {
  const texto = q.trim()
  if (!texto) return []
  const digitos = texto.replace(/\D/g, "")
  const porNombre = sql`unaccent(${alegraContacts.name}) ILIKE unaccent(${`%${literalLike(texto)}%`})`
  const criterio = digitos.length >= 6 ? or(porNombre, eq(alegraContacts.identificationNorm, digitos)) : porNombre

  const rows = await getDb()
    .select()
    .from(alegraContacts)
    .where(and(activasDel(config), criterio))
    .orderBy(asc(alegraContacts.name), asc(alegraContacts.alegraId))
    .limit(limit)
  if (rows.length > 0) return rows.map(contactoDeFila)

  return guardarFallback(config, await searchContactsRaw(config, texto, limit))
}

/**
 * Contactos cuyo teléfono (cualquiera de los tres) coincide, sin cuentas internas. Devuelve
 * TODOS: más de uno es el caso ambiguo y quien llama no debe elegir. Sin fallback: Alegra no
 * filtra por teléfono, así que buscar en vivo sería recorrer el padrón.
 */
export async function buscarPorTelefono(config: TenantConfig, telefono: string): Promise<ContactoEspejo[]> {
  const buscado = normalizePhone(telefono)
  if (!buscado) return []
  const rows = await getDb()
    .select()
    .from(alegraContacts)
    .where(and(activasDel(config), sql`${alegraContacts.phonesNorm} @> ARRAY[${buscado}]::text[]`))
    .orderBy(asc(alegraContacts.alegraId))
  return rows.filter((r) => esCliente(r.name)).map(contactoDeFila)
}

/**
 * Todos los contactos activos del tenant (gestor de cobranza / notificaciones). Sin fallback:
 * si el espejo está vacío no se recorre Alegra, se avisa en el log y se devuelve vacío.
 */
export async function clientesActivos(config: TenantConfig): Promise<ContactoEspejo[]> {
  const rows = await getDb()
    .select()
    .from(alegraContacts)
    .where(and(activasDel(config), sql`coalesce(${alegraContacts.alegraStatus}, 'active') = 'active'`))
    .orderBy(asc(alegraContacts.alegraId))
  if (rows.length === 0) console.warn(`[contactos] tenant=${config.id} espejo_vacio: sin contactos activos`)
  return rows.map(contactoDeFila)
}

/**
 * Crea el contacto en Alegra (1 request) y lo escribe en el espejo en el momento
 * (write-through): el bot lo encuentra por teléfono enseguida, sin esperar a la sync. Si la
 * base falla, el contacto YA existe en Alegra: se devuelve igual, sin reintentar Alegra.
 */
export async function crearContacto(config: TenantConfig, input: AlegraContactInput): Promise<AlegraContact> {
  const raw = await createContactRaw(config, input)
  const fila = mapRawContactRow(raw)
  try {
    const [row] = await upsertContactos(config.id, [fila], "write_through")
    if (row) return contactoDeFila(row)
  } catch (err) {
    console.error(
      `[contactos] tenant=${config.id} write-through falló para ${fila.alegraId}:`,
      err instanceof Error ? err.name : "desconocido",
    )
  }
  return contactoDeCampos(fila)
}
