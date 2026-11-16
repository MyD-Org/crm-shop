import { and, asc, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraComprasConfig, alegraCuentas, sucursales } from "@/db/schema"
import { configParaCuenta } from "./sucursales-cuenta"
import { getTenantByIdFromDb, type TenantConfig } from "./tenants"

// Cuentas de Alegra y configuración de Compras por cuenta (change `compras-en-transito`, S4).
// TODO filtra por `tenantId` (el del guard).

export type CuentaFila = typeof alegraCuentas.$inferSelect
export type ConfigComprasFila = typeof alegraComprasConfig.$inferSelect

export interface CuentaCompras {
  id: string
  slug: string
  /** Nombre que ve el usuario: el de la sucursal activa que usa la cuenta, o el de la cuenta. */
  nombre: string
  principal: boolean
}

export const MSG_CUENTA_NO_EXISTE = "La cuenta de Alegra seleccionada no existe o está inactiva."

/** Cuentas activas del tenant, con el nombre de su sucursal (IGZ / MDP) cuando la hay. */
export async function listarCuentasCompras(tenantId: string): Promise<CuentaCompras[]> {
  const db = getDb()
  const [cuentas, suc] = await Promise.all([
    db
      .select()
      .from(alegraCuentas)
      .where(and(eq(alegraCuentas.tenantId, tenantId), eq(alegraCuentas.activa, true)))
      .orderBy(asc(alegraCuentas.principal), asc(alegraCuentas.slug)),
    db
      .select({ nombre: sucursales.nombre, cuentaAlegraId: sucursales.cuentaAlegraId, activa: sucursales.activa, orden: sucursales.orden })
      .from(sucursales)
      .where(eq(sucursales.tenantId, tenantId))
      .orderBy(asc(sucursales.orden)),
  ])
  return cuentas.map((c) => {
    const deCuenta = suc.filter((s) => s.cuentaAlegraId === c.id)
    const visible = (deCuenta.find((s) => s.activa !== false) ?? deCuenta[0])?.nombre
    return { id: c.id, slug: c.slug, nombre: visible ?? c.nombre, principal: c.principal }
  })
}

/** La fila de la cuenta activa con ese slug, o null. */
export async function cuentaActivaPorSlug(tenantId: string, slug: string): Promise<CuentaFila | null> {
  const [c] = await getDb()
    .select()
    .from(alegraCuentas)
    .where(and(eq(alegraCuentas.tenantId, tenantId), eq(alegraCuentas.slug, slug), eq(alegraCuentas.activa, true)))
  return c ?? null
}

export async function cuentaPorId(tenantId: string, id: string): Promise<CuentaFila | null> {
  const [c] = await getDb()
    .select()
    .from(alegraCuentas)
    .where(and(eq(alegraCuentas.tenantId, tenantId), eq(alegraCuentas.id, id)))
  return c ?? null
}

/** TenantConfig para hablar con la cuenta (credenciales de ESA cuenta; lanza en usted si faltan). */
export async function configAlegraDeCuenta(tenantId: string, cuenta: CuentaFila): Promise<TenantConfig> {
  const base = await getTenantByIdFromDb(tenantId)
  if (!base) throw new Error("No se encontró la empresa.")
  return configParaCuenta(base, cuenta)
}

export async function obtenerConfigCompras(tenantId: string, cuentaId: string): Promise<ConfigComprasFila | null> {
  const [c] = await getDb()
    .select()
    .from(alegraComprasConfig)
    .where(and(eq(alegraComprasConfig.tenantId, tenantId), eq(alegraComprasConfig.cuentaId, cuentaId)))
  return c ?? null
}

/** Nombres de percepción configurados por cuenta (slug -> nombres), para el formulario de compra. */
export async function nombresPercepcionPorCuenta(tenantId: string, cuentas: CuentaCompras[]): Promise<Record<string, string[]>> {
  const filas = await getDb().select().from(alegraComprasConfig).where(eq(alegraComprasConfig.tenantId, tenantId))
  const out: Record<string, string[]> = {}
  for (const c of cuentas) {
    const f = filas.find((x) => x.cuentaId === c.id)
    out[c.slug] = Object.keys(f?.percepciones ?? {}).sort()
  }
  return out
}

export interface PatchConfigCompras {
  /** Override de la cuenta contable de tránsito (id en Alegra); null = resolver por nombre. */
  categoriaTransitoId?: string | null
  /** nombre visible -> idPerception (uuid) del catálogo de percepciones de Alegra. */
  percepciones?: Record<string, string>
  almacenId?: string | null
}

export async function guardarConfigCompras(
  tenantId: string,
  cuentaId: string,
  patch: PatchConfigCompras,
  usuarioId: string | null,
): Promise<ConfigComprasFila> {
  const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: usuarioId }
  if (patch.categoriaTransitoId !== undefined) set.categoriaTransitoId = patch.categoriaTransitoId
  if (patch.percepciones !== undefined) set.percepciones = patch.percepciones
  if (patch.almacenId !== undefined) set.almacenId = patch.almacenId
  const [fila] = await getDb()
    .insert(alegraComprasConfig)
    .values({ tenantId, cuentaId, updatedBy: usuarioId, ...(set as object) })
    .onConflictDoUpdate({ target: [alegraComprasConfig.tenantId, alegraComprasConfig.cuentaId], set })
    .returning()
  return fila
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Valida el body del PUT de configuración. Mensajes en usted. */
export function validarPatchConfig(
  raw: unknown,
): { ok: true; value: PatchConfigCompras } | { ok: false; error: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "La solicitud no es válida." }
  const b = raw as Record<string, unknown>
  const out: PatchConfigCompras = {}
  if ("categoriaTransitoId" in b) {
    const v = b.categoriaTransitoId
    if (v !== null && (typeof v !== "string" || !/^[\w-]{1,60}$/.test(v))) {
      return { ok: false, error: "La cuenta contable de tránsito indicada no es válida." }
    }
    out.categoriaTransitoId = v === "" ? null : (v as string | null)
  }
  if ("almacenId" in b) {
    const v = b.almacenId
    if (v !== null && (typeof v !== "string" || v.length > 60)) return { ok: false, error: "El depósito indicado no es válido." }
    out.almacenId = v === "" ? null : (v as string | null)
  }
  if ("percepciones" in b) {
    const p = b.percepciones
    if (p === null || typeof p !== "object" || Array.isArray(p)) return { ok: false, error: "Las percepciones no son válidas." }
    const mapa: Record<string, string> = {}
    for (const [nombre, id] of Object.entries(p as Record<string, unknown>)) {
      if (!nombre.trim() || nombre.length > 120 || typeof id !== "string" || !UUID.test(id.trim())) {
        return { ok: false, error: `El identificador de la percepción «${nombre}» no es válido. Debe ser el código que muestra Alegra.` }
      }
      mapa[nombre.trim()] = id.trim()
    }
    out.percepciones = mapa
  }
  return { ok: true, value: out }
}
