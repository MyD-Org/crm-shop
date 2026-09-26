import { sql, type SQL } from "drizzle-orm"
import { getDb } from "@/db"
import { CUENTA_ALEGRA_PRINCIPAL } from "@/lib/alegra-contacts-repo"

// Listado "Clientes de la tienda" del admin: usuarios registrados en el Shop (espejo de Clerk,
// `shop.clientes`, 0018 del Shop) con su vínculo a Alegra, el acceso a Facturación y sus pedidos.
//
// Reglas de este archivo:
//  - `tenantId` es SIEMPRE el primer argumento. El ancla del tenant es `shop.clientes.tenant_id`
//    (`shop.client_links` no tiene tenant); pedidos y contactos se filtran además por el mismo
//    tenant, así un clerk_user_id repetido en dos tiendas no mezcla datos.
//  - SQL crudo parametrizado (design D10): LATERAL para el último vínculo y los pedidos. Sólo
//    lectura: el CRM no escribe nada de estas tablas en R3.
//  - Acceso a Facturación = la MISMA regla que el Shop (`accesoFacturacion()`): vínculo activo +
//    contacto activo de la cuenta principal del tenant con tipo_cuenta 'corriente'. Contacto
//    ausente o inactivo ⇒ "no" (fail-closed). La excepción por contacto llega en R4a.

export const CLIENTES_TIENDA_DEFAULT_LIMIT = 25
export const CLIENTES_TIENDA_MAX_LIMIT = 50
/** Largo máximo de la búsqueda (la API responde 400 por encima). */
export const CLIENTES_TIENDA_Q_MAX = 100

export const FILTROS_VINCULO = ["todos", "vinculados", "sin_vincular"] as const
export const FILTROS_ACCESO = ["todos", "con", "sin"] as const
export const FILTROS_PEDIDOS = ["todos", "con"] as const
export type FiltroVinculo = (typeof FILTROS_VINCULO)[number]
export type FiltroAcceso = (typeof FILTROS_ACCESO)[number]
export type FiltroPedidos = (typeof FILTROS_PEDIDOS)[number]

export interface ListarClientesTiendaFiltro {
  q?: string
  vinculo?: FiltroVinculo
  acceso?: FiltroAcceso
  pedidos?: FiltroPedidos
  start?: number
  /** Default CLIENTES_TIENDA_DEFAULT_LIMIT, máximo CLIENTES_TIENDA_MAX_LIMIT. */
  limit?: number
}

export type EstadoVinculo = "sin_vincular" | "sin_coincidencia" | "ambiguo" | "vinculado" | "revocado"
export type AccesoFacturacion = "corriente" | "excepcion" | "no"

export interface ClienteTiendaDto {
  clerkUserId: string
  nombre: string | null
  email: string | null
  /** Alta en Clerk (ISO). */
  altaEn: string | null
  vinculo: {
    estado: EstadoVinculo
    metodo: string | null
    alegraContactId: string | null
    /** Nombre del contacto en el espejo si está activo; si no, el snapshot del vínculo. */
    razonSocial: string | null
    desde: string | null
  }
  /** Del espejo, sólo con vínculo activo y contacto activo. */
  tipoCuenta: "corriente" | "contado" | null
  /** "excepcion" recién desde R4a. */
  acceso: AccesoFacturacion
  /** R4a. En R3 siempre false. */
  excepcionVigente: boolean
  pedidos: number
  ultimoPedidoEn: string | null
}

interface FilaListado {
  clerk_user_id: string
  nombre: string | null
  email: string | null
  creado_en_clerk: Date | string | null
  link_estado: string | null
  link_metodo: string | null
  alegra_contact_id: string | null
  razon_social: string | null
  link_desde: Date | string | null
  tipo_cuenta: string | null
  acceso_corriente: boolean
  pedidos: number
  ultimo_pedido: Date | string | null
}

/** `%`, `_` y `\` literales dentro de un ILIKE (el escape por defecto es `\`). */
export function patronBusqueda(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function iso(v: Date | string | null): string | null {
  if (v === null || v === undefined) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function estadoVinculo(estado: string | null, alegraContactId: string | null): EstadoVinculo {
  if (estado === null) return "sin_vincular"
  if (estado === "activa") return "vinculado"
  if (estado === "revocada") return "revocado"
  // 'sin_coincidencia': el Shop guarda '' (0 coincidencias) o 'ambiguo' (más de una).
  return alegraContactId === "ambiguo" ? "ambiguo" : "sin_coincidencia"
}

function aDto(f: FilaListado): ClienteTiendaDto {
  const estado = estadoVinculo(f.link_estado, f.alegra_contact_id)
  const conFila = estado === "vinculado" || estado === "revocado"
  const tipo = f.tipo_cuenta === "corriente" || f.tipo_cuenta === "contado" ? f.tipo_cuenta : null
  return {
    clerkUserId: f.clerk_user_id,
    nombre: f.nombre,
    email: f.email,
    altaEn: iso(f.creado_en_clerk),
    vinculo: {
      estado,
      metodo: f.link_metodo,
      alegraContactId: conFila ? f.alegra_contact_id || null : null,
      razonSocial: conFila ? f.razon_social : null,
      desde: iso(f.link_desde),
    },
    tipoCuenta: tipo,
    acceso: f.acceso_corriente ? "corriente" : "no",
    excepcionVigente: false,
    pedidos: Number(f.pedidos) || 0,
    ultimoPedidoEn: iso(f.ultimo_pedido),
  }
}

export async function listarClientesTienda(
  tenantId: string,
  filtro: ListarClientesTiendaFiltro = {},
): Promise<{ items: ClienteTiendaDto[]; total: number }> {
  const start = Math.max(0, Math.trunc(filtro.start ?? 0) || 0)
  const limit = Math.min(
    CLIENTES_TIENDA_MAX_LIMIT,
    Math.max(1, Math.trunc(filtro.limit ?? CLIENTES_TIENDA_DEFAULT_LIMIT) || CLIENTES_TIENDA_DEFAULT_LIMIT),
  )
  const q = (filtro.q ?? "").trim().slice(0, CLIENTES_TIENDA_Q_MAX)

  const busqueda: SQL = q
    ? sql`AND (c.nombre ILIKE ${patronBusqueda(q)}
              OR c.email_norm LIKE ${patronBusqueda(q.toLowerCase())}
              OR coalesce(v.name, l.razon_social) ILIKE ${patronBusqueda(q)})`
    : sql``

  // CTE compartida por la página y el conteo. El vínculo que se muestra es el activo si hay
  // uno; si no, el más reciente (cl_usuario_fecha, 0018 del Shop). El contacto sólo se une con
  // vínculo activo y contacto activo, igual que decide el Shop.
  const base = sql`
    WITH base AS (
      SELECT c.id, c.clerk_user_id, c.nombre, c.email, c.creado_en_clerk,
             l.estado AS link_estado, l.metodo AS link_metodo, l.alegra_contact_id,
             coalesce(v.name, l.razon_social) AS razon_social, l.created_at AS link_desde,
             v.tipo_cuenta,
             coalesce(v.tipo_cuenta = 'corriente', false) AS acceso_corriente,
             o.pedidos, o.ultimo_pedido
      FROM shop.clientes c
      LEFT JOIN LATERAL (
        SELECT cl.estado, cl.metodo, cl.alegra_contact_id, cl.razon_social, cl.created_at
        FROM shop.client_links cl
        WHERE cl.clerk_user_id = c.clerk_user_id
        ORDER BY (cl.estado = 'activa') DESC, cl.created_at DESC, cl.id DESC
        LIMIT 1
      ) l ON true
      LEFT JOIN public.alegra_contacts v
        ON l.estado = 'activa'
       AND v.tenant_id = c.tenant_id
       AND v.alegra_account = ${CUENTA_ALEGRA_PRINCIPAL}
       AND v.alegra_id = l.alegra_contact_id
       AND v.status = 'active'
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS pedidos, max(so.created_at) AS ultimo_pedido
        FROM shop.orders so
        WHERE so.tenant_id = c.tenant_id AND so.clerk_user_id = c.clerk_user_id
      ) o ON true
      WHERE c.tenant_id = ${tenantId} AND c.eliminado_en IS NULL
      ${busqueda}
    )`

  const condiciones: SQL[] = []
  if (filtro.vinculo === "vinculados") condiciones.push(sql`link_estado = 'activa'`)
  if (filtro.vinculo === "sin_vincular") condiciones.push(sql`link_estado IS DISTINCT FROM 'activa'`)
  if (filtro.acceso === "con") condiciones.push(sql`acceso_corriente`)
  if (filtro.acceso === "sin") condiciones.push(sql`NOT acceso_corriente`)
  if (filtro.pedidos === "con") condiciones.push(sql`pedidos > 0`)
  const where = condiciones.length ? sql`WHERE ${sql.join(condiciones, sql` AND `)}` : sql``

  const [filas, conteo] = await Promise.all([
    getDb().execute(sql`
      ${base}
      SELECT * FROM base ${where}
      ORDER BY creado_en_clerk DESC NULLS LAST, id DESC
      LIMIT ${limit} OFFSET ${start}
    `),
    getDb().execute(sql`${base} SELECT count(*)::int AS total FROM base ${where}`),
  ])

  const items = (filas as unknown as FilaListado[]).map(aDto)
  const total = Number((conteo as unknown as { total: number }[])[0]?.total ?? 0)
  return { items, total }
}
