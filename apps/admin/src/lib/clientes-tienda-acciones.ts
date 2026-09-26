import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { CUENTA_ALEGRA_PRINCIPAL } from "@/lib/alegra-contacts-repo"
import { patronBusqueda } from "@/lib/clientes-tienda-repo"

// Acciones de "Clientes de la tienda" (R4a de clientes-tienda-admin), sólo para admin y
// superadmin (la autoridad es `requireAdminPlus` en las rutas; la UI sólo esconde botones):
//  - Excepción de acceso a Facturación por CONTACTO de Alegra (`contactos_acceso_facturacion`,
//    0039). Otorgar = INSERT de una vigente; quitar = UPDATE de revocado_* (nunca DELETE).
//  - Vincular / desvincular un usuario de la tienda a un contacto (`shop.client_links`, metodo
//    'operador', auditoría de la 0019 del Shop). Desvincular = estado 'revocada' (nunca DELETE).
//
// Reglas de este archivo:
//  - `tenantId` es SIEMPRE el primer argumento y sale del guard. `shop.client_links` no tiene
//    tenant: el usuario se verifica contra `shop.clientes` del tenant (y no eliminado) y el
//    contacto contra `alegra_contacts` del tenant, cuenta principal, activo y de tipo cliente.
//  - `actor` ({id, name}) sale de la fila fresca de admin_users (guard), nunca del body.
//  - Resultados como uniones discriminadas (patrón `registrarPagoManual`); la ruta los traduce.
//  - Logs de una línea en JSON con ids y el actor: nunca emails ni razones sociales.

export interface Actor {
  id: string
  name: string
}

export interface ContactoParaVincular {
  alegraId: string
  nombre: string
  identificacion: string | null
  email: string | null
  tipoCuenta: "corriente" | "contado" | null
  /** `acceso_facturacion` de la vista: la misma regla que aplica el Shop. */
  acceso: boolean
}

/** Formato de un id de usuario de Clerk. Otro formato ⇒ la ruta responde el 404 del guard. */
export const CLERK_USER_ID_RE = /^user_[A-Za-z0-9]+$/
/** Id de contacto de Alegra (numérico en la cuenta real; `ct-1` en el mock). */
export const ALEGRA_ID_RE = /^[A-Za-z0-9-]{1,40}$/

export const BUSCAR_CONTACTOS_LIMITE = 10
export const BUSCAR_CONTACTOS_Q_MIN = 2
export const BUSCAR_CONTACTOS_Q_MAX = 100

/** Sólo dígitos de CUIT/DNI: con 3 o más se busca también por identificación. */
const DIGITOS_MIN_IDENTIFICACION = 3

function log(event: string, datos: Record<string, unknown>, actor: Actor) {
  console.info(JSON.stringify({ event, ...datos, actor: { id: actor.id, name: actor.name }, at: new Date().toISOString() }))
}

function tipoCuenta(v: unknown): "corriente" | "contado" | null {
  return v === "corriente" || v === "contado" ? v : null
}

/**
 * Buscador del diálogo "Vincular": clientes activos de la cuenta principal del tenant por
 * razón social, CUIT (desde 3 dígitos, ignorando guiones) o cualquier email de `emails_norm`
 * (incluye personas asociadas). Lee la VISTA para devolver el acceso con la regla del Shop.
 */
export async function buscarContactosParaVincular(tenantId: string, q: string): Promise<ContactoParaVincular[]> {
  const texto = q.trim().slice(0, BUSCAR_CONTACTOS_Q_MAX)
  if (texto.length < BUSCAR_CONTACTOS_Q_MIN) return []
  const patron = patronBusqueda(texto)
  const patronEmail = patronBusqueda(texto.toLowerCase())
  const digitos = texto.replace(/\D/g, "")
  const porIdentificacion =
    digitos.length >= DIGITOS_MIN_IDENTIFICACION ? sql`OR v.identification_norm LIKE ${`${digitos}%`}` : sql``

  const filas = (await getDb().execute(sql`
    SELECT v.alegra_id, v.name, v.identification, v.email, v.tipo_cuenta, v.acceso_facturacion
    FROM public.alegra_contacts_shop v
    WHERE v.tenant_id = ${tenantId}
      AND v.alegra_account = ${CUENTA_ALEGRA_PRINCIPAL}
      AND v.status = 'active'
      AND 'client' = ANY(v.types)
      AND (v.name ILIKE ${patron}
           ${porIdentificacion}
           OR EXISTS (SELECT 1 FROM unnest(v.emails_norm) e WHERE e LIKE ${patronEmail}))
    ORDER BY v.name, v.alegra_id
    LIMIT ${BUSCAR_CONTACTOS_LIMITE}
  `)) as unknown as {
    alegra_id: string
    name: string
    identification: string | null
    email: string | null
    tipo_cuenta: string | null
    acceso_facturacion: boolean
  }[]

  return filas.map((f) => ({
    alegraId: f.alegra_id,
    nombre: f.name,
    identificacion: f.identification,
    email: f.email,
    tipoCuenta: tipoCuenta(f.tipo_cuenta),
    acceso: f.acceso_facturacion === true,
  }))
}

// ───────────────────────── Vincular / desvincular ─────────────────────────

export type VincularResult =
  | { kind: "ok"; cambio: boolean; razonSocial: string | null }
  /** Usuario inexistente, eliminado o de otro tenant: la ruta responde el 404 del guard. */
  | { kind: "not_found" }
  /** El contacto no es un cliente activo de la cuenta principal del tenant. */
  | { kind: "contacto_invalido" }
  /** Ya tiene un vínculo activo a OTRO contacto. `razonSocial` null si no es de este tenant. */
  | { kind: "ya_vinculado"; razonSocial: string | null }

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]

interface VinculoActivo {
  alegra_contact_id: string
  razon_social: string | null
}

/**
 * Razón social de un vínculo activo para el 409, sólo si su contacto es de ESTE tenant:
 * `client_links` no tiene tenant y el mismo usuario de Clerk podría estar en otra tienda.
 */
async function razonSocialDelTenant(tx: Tx, tenantId: string, activo: VinculoActivo): Promise<string | null> {
  const [c] = (await tx.execute(sql`
    SELECT name FROM public.alegra_contacts
    WHERE tenant_id = ${tenantId} AND alegra_account = ${CUENTA_ALEGRA_PRINCIPAL}
      AND alegra_id = ${activo.alegra_contact_id}
  `)) as unknown as { name: string }[]
  return c ? c.name : null
}

async function vinculoActivo(tx: Tx, clerkUserId: string): Promise<VinculoActivo | undefined> {
  const [l] = (await tx.execute(sql`
    SELECT alegra_contact_id, razon_social FROM shop.client_links
    WHERE clerk_user_id = ${clerkUserId} AND estado = 'activa'
    FOR UPDATE
  `)) as unknown as VinculoActivo[]
  return l
}

/**
 * Bloquea la fila del usuario en `shop.clientes` del tenant (FOR UPDATE): serializa dos
 * acciones sobre el mismo usuario. Sin fila (o eliminado) ⇒ false.
 */
async function bloquearUsuario(tx: Tx, tenantId: string, clerkUserId: string): Promise<boolean> {
  const [u] = (await tx.execute(sql`
    SELECT 1 AS ok FROM shop.clientes
    WHERE tenant_id = ${tenantId} AND clerk_user_id = ${clerkUserId} AND eliminado_en IS NULL
    FOR UPDATE
  `)) as unknown as { ok: number }[]
  return Boolean(u)
}

/**
 * Vincula a mano un usuario de la tienda a un contacto de Alegra (confirmación explícita en la
 * UI). Guarda el mismo snapshot que el Shop (`snapshotDelContacto`): razón social, CUIT, lista
 * de precios (null si Alegra la marca no activa, regla `idPriceListUsable`) y tipo de cuenta.
 * Mismo contacto ⇒ ok sin cambios. Otro activo ⇒ ya_vinculado. Una carrera que igual choque
 * con `cl_user_activa` (23505) se relee y se resuelve igual.
 */
export async function vincularUsuario(
  tenantId: string,
  clerkUserId: string,
  alegraContactId: string,
  actor: Actor,
): Promise<VincularResult> {
  const resultado = await getDb()
    .transaction(async (tx): Promise<VincularResult> => {
      if (!(await bloquearUsuario(tx, tenantId, clerkUserId))) return { kind: "not_found" }

      const [contacto] = (await tx.execute(sql`
        SELECT name, identification, price_list_id, price_list_status, tipo_cuenta
        FROM public.alegra_contacts
        WHERE tenant_id = ${tenantId} AND alegra_account = ${CUENTA_ALEGRA_PRINCIPAL}
          AND alegra_id = ${alegraContactId} AND status = 'active' AND 'client' = ANY(types)
      `)) as unknown as {
        name: string
        identification: string | null
        price_list_id: string | null
        price_list_status: string | null
        tipo_cuenta: string | null
      }[]
      if (!contacto) return { kind: "contacto_invalido" }

      const activo = await vinculoActivo(tx, clerkUserId)
      if (activo) {
        if (activo.alegra_contact_id === alegraContactId) {
          return { kind: "ok", cambio: false, razonSocial: contacto.name }
        }
        return { kind: "ya_vinculado", razonSocial: await razonSocialDelTenant(tx, tenantId, activo) }
      }

      const idPriceList =
        contacto.price_list_id && (!contacto.price_list_status || contacto.price_list_status === "active")
          ? contacto.price_list_id
          : null
      await tx.execute(sql`
        INSERT INTO shop.client_links
          (clerk_user_id, alegra_contact_id, razon_social, cuit, id_price_list, tipo_cuenta,
           estado, metodo, vinculado_por, vinculado_por_nombre)
        VALUES (${clerkUserId}, ${alegraContactId}, ${contacto.name}, ${contacto.identification},
                ${idPriceList}, ${tipoCuenta(contacto.tipo_cuenta)}, 'activa', 'operador',
                ${actor.id}, ${actor.name})
      `)
      return { kind: "ok", cambio: true, razonSocial: contacto.name }
    })
    .catch(async (err: unknown) => {
      // Carrera contra otro camino que no toma el lock de shop.clientes (p. ej. el auto-vínculo
      // del Shop): el índice parcial `cl_user_activa` rechazó el segundo activo. Se relee.
      if ((err as { code?: string })?.code !== "23505") throw err
      return getDb().transaction(async (tx): Promise<VincularResult> => {
        const activo = await vinculoActivo(tx, clerkUserId)
        if (activo?.alegra_contact_id === alegraContactId) {
          return { kind: "ok", cambio: false, razonSocial: await razonSocialDelTenant(tx, tenantId, activo) }
        }
        return { kind: "ya_vinculado", razonSocial: activo ? await razonSocialDelTenant(tx, tenantId, activo) : null }
      })
    })

  if (resultado.kind === "ok" && resultado.cambio) {
    log("shop_cliente_vinculado", { tenant: tenantId, clerkUserId, alegraId: alegraContactId }, actor)
  }
  return resultado
}

export type DesvincularResult = { kind: "ok"; cambio: boolean } | { kind: "not_found" }

/** Revoca el vínculo activo (estado 'revocada' + revoked_at + quién). Nunca DELETE. */
export async function desvincularUsuario(tenantId: string, clerkUserId: string, actor: Actor): Promise<DesvincularResult> {
  const resultado = await getDb().transaction(async (tx): Promise<DesvincularResult & { alegraId?: string }> => {
    if (!(await bloquearUsuario(tx, tenantId, clerkUserId))) return { kind: "not_found" }
    const filas = (await tx.execute(sql`
      UPDATE shop.client_links
      SET estado = 'revocada', revoked_at = now(), revocado_por = ${actor.id}, revocado_por_nombre = ${actor.name}
      WHERE clerk_user_id = ${clerkUserId} AND estado = 'activa'
      RETURNING alegra_contact_id
    `)) as unknown as { alegra_contact_id: string }[]
    return filas.length ? { kind: "ok", cambio: true, alegraId: filas[0].alegra_contact_id } : { kind: "ok", cambio: false }
  })

  if (resultado.kind === "not_found") return resultado
  if (resultado.cambio) {
    log("shop_cliente_desvinculado", { tenant: tenantId, clerkUserId, alegraId: resultado.alegraId }, actor)
  }
  return { kind: "ok", cambio: resultado.cambio }
}

// ───────────────────────── Excepción de acceso ─────────────────────────

export type OtorgarResult =
  | { kind: "ok"; cambio: boolean }
  | { kind: "contacto_invalido" }
  /** Ya tiene acceso por cuenta corriente: no se crean excepciones invisibles. */
  | { kind: "es_cuenta_corriente" }

export async function otorgarAcceso(tenantId: string, alegraId: string, actor: Actor): Promise<OtorgarResult> {
  const [contacto] = (await getDb().execute(sql`
    SELECT tipo_cuenta FROM public.alegra_contacts
    WHERE tenant_id = ${tenantId} AND alegra_account = ${CUENTA_ALEGRA_PRINCIPAL}
      AND alegra_id = ${alegraId} AND status = 'active' AND 'client' = ANY(types)
  `)) as unknown as { tipo_cuenta: string | null }[]
  if (!contacto) return { kind: "contacto_invalido" }
  if (contacto.tipo_cuenta === "corriente") return { kind: "es_cuenta_corriente" }

  // Doble click u otro admin a la vez: el índice parcial `caf_vigente` deja una sola vigente.
  const insertadas = (await getDb().execute(sql`
    INSERT INTO public.contactos_acceso_facturacion
      (tenant_id, alegra_account, alegra_id, otorgado_por, otorgado_por_nombre)
    VALUES (${tenantId}, ${CUENTA_ALEGRA_PRINCIPAL}, ${alegraId}, ${actor.id}, ${actor.name})
    ON CONFLICT (tenant_id, alegra_account, alegra_id) WHERE revocado_en IS NULL DO NOTHING
    RETURNING id
  `)) as unknown as { id: string }[]
  const cambio = insertadas.length > 0
  if (cambio) log("acceso_facturacion_otorgado", { tenant: tenantId, alegraId }, actor)
  return { kind: "ok", cambio }
}

/**
 * Quita la excepción vigente (UPDATE de revocado_*; el historial queda). No exige que el
 * contacto siga activo: tiene que poder quitarse aunque la sync lo haya dejado inactivo.
 */
export async function quitarAcceso(tenantId: string, alegraId: string, actor: Actor): Promise<{ kind: "ok"; cambio: boolean }> {
  const filas = (await getDb().execute(sql`
    UPDATE public.contactos_acceso_facturacion
    SET revocado_en = now(), revocado_por = ${actor.id}, revocado_por_nombre = ${actor.name}
    WHERE tenant_id = ${tenantId} AND alegra_account = ${CUENTA_ALEGRA_PRINCIPAL}
      AND alegra_id = ${alegraId} AND revocado_en IS NULL
    RETURNING id
  `)) as unknown as { id: string }[]
  const cambio = filas.length > 0
  if (cambio) log("acceso_facturacion_quitado", { tenant: tenantId, alegraId }, actor)
  return { kind: "ok", cambio }
}
