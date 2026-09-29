import { and, asc, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas, sucursales, tenants } from "@/db/schema"
import { slugDeCuenta, validarCuentaEntrada, type CuentaEntrada } from "@/lib/alegra-cuentas-validacion"
import {
  configParaCuenta,
  configParaSucursalSinCuenta,
  MSG_SIN_CUENTA,
  ultimos4,
  type CuentaCredenciales,
} from "@/lib/sucursales-cuenta"
import { tenantConfigFromRow, type TenantConfig } from "@/lib/tenants"

// Acceso a datos de las cuentas de Alegra de las sucursales (change `sucursales-igz-mdp`,
// rebanada D). TODO filtra por `tenantId` (el del guard, nunca el del body).
//
// Seguridad: el DTO NUNCA lleva el token. Solo `tokenConfigurado` y, si el token es lo bastante
// largo, sus últimos 4 caracteres. La cuenta PRINCIPAL no guarda credenciales propias: el DTO
// informa las del tenant (`tenants`), que es de donde las lee el resto del CRM.
//
// Modos por sucursal: "ninguna" (sin cuenta), "principal" (la cuenta del negocio) o "propia"
// (cuenta secundaria con su email/token/CUIT). El slug de la cuenta propia se deriva del de la
// sucursal (recortado a 12) y es inmutable. Un lock por tenant (el mismo de sucursales) serializa
// las escrituras de configuración.

type CuentaRow = typeof alegraCuentas.$inferSelect
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]

export interface CuentaDto {
  slug: string
  nombre: string
  cuit: string
  principal: boolean
  activa: boolean
  mock: boolean
  email: string
  tokenConfigurado: boolean
  tokenUltimos4: string | null
}

export interface CuentasYAsignaciones {
  cuentas: CuentaDto[]
  /** slug de sucursal -> slug de su cuenta (null = sin asignar). */
  asignaciones: Record<string, string | null>
}

export type ResultadoCuenta =
  | { kind: "ok"; cuenta: CuentaDto | null }
  | { kind: "invalid"; campo: string; error: string }
  | { kind: "conflict"; campo: string; error: string }
  | { kind: "not_found" }

const MSG_CONCURRENCIA = "Otro usuario modificó las sucursales al mismo tiempo. Inténtelo nuevamente."

export function toCuentaDto(r: CuentaRow, tenantCreds?: { email: string; token: string }): CuentaDto {
  const email = r.principal ? (tenantCreds?.email ?? "") : r.alegraEmail
  const token = r.principal ? (tenantCreds?.token ?? "") : r.alegraToken
  return {
    slug: r.slug,
    nombre: r.nombre,
    cuit: r.cuit,
    principal: r.principal,
    activa: r.activa,
    mock: r.principal ? false : r.alegraMock,
    email,
    tokenConfigurado: token !== "",
    tokenUltimos4: ultimos4(token),
  }
}

function codigoPg(err: unknown): string | undefined {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  return undefined
}

async function bloquearTenant(tx: Tx, tenantId: string): Promise<void> {
  // Mismo lock que el repo de sucursales: alta de sucursal y asignación de cuenta se serializan.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sucursales:${tenantId}`}))`)
}

async function credencialesDelTenant(tenantId: string): Promise<{ email: string; token: string }> {
  const [t] = await getDb()
    .select({ email: tenants.alegraEmail, token: tenants.alegraToken })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
  return { email: t?.email ?? "", token: t?.token ?? "" }
}

export async function listarCuentas(tenantId: string): Promise<CuentasYAsignaciones> {
  const db = getDb()
  const [filas, suc, creds] = await Promise.all([
    db
      .select()
      .from(alegraCuentas)
      .where(eq(alegraCuentas.tenantId, tenantId))
      .orderBy(asc(alegraCuentas.principal), asc(alegraCuentas.slug)),
    db
      .select({ slug: sucursales.slug, cuentaId: sucursales.cuentaAlegraId })
      .from(sucursales)
      .where(eq(sucursales.tenantId, tenantId)),
    credencialesDelTenant(tenantId),
  ])
  const slugPorId = new Map(filas.map((c) => [c.id, c.slug]))
  return {
    cuentas: filas.map((c) => toCuentaDto(c, creds)),
    asignaciones: Object.fromEntries(suc.map((s) => [s.slug, s.cuentaId ? (slugPorId.get(s.cuentaId) ?? null) : null])),
  }
}

/** La cuenta principal del tenant; la crea si falta (tenants dados de alta después de la 0042). */
async function principalDe(tx: Tx, tenantId: string): Promise<CuentaRow> {
  const [existente] = await tx
    .select()
    .from(alegraCuentas)
    .where(and(eq(alegraCuentas.tenantId, tenantId), eq(alegraCuentas.principal, true)))
  if (existente) return existente
  const [t] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId))
  const [fila] = await tx
    .insert(alegraCuentas)
    .values({ tenantId, slug: "principal", nombre: t?.name ?? "Cuenta principal", principal: true })
    .returning()
  return fila
}

/**
 * Asigna (o quita) la cuenta de Alegra de una sucursal, y en modo "propia" crea o edita sus
 * credenciales. El token es write-only: vacío en una edición = conservar el guardado.
 */
export async function guardarCuentaDeSucursal(
  tenantId: string,
  slugSucursal: string,
  body: unknown,
): Promise<ResultadoCuenta> {
  try {
    return await getDb().transaction(async (tx): Promise<ResultadoCuenta> => {
      await bloquearTenant(tx, tenantId)

      const [suc] = await tx
        .select()
        .from(sucursales)
        .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.slug, slugSucursal)))
      if (!suc) return { kind: "not_found" }

      const [actual] = suc.cuentaAlegraId
        ? await tx
            .select()
            .from(alegraCuentas)
            .where(and(eq(alegraCuentas.tenantId, tenantId), eq(alegraCuentas.id, suc.cuentaAlegraId)))
        : []
      const propiaActual = actual && !actual.principal ? actual : null

      const v = validarCuentaEntrada(body, { esAlta: !propiaActual })
      if (!v.ok) return { kind: "invalid", campo: v.campo, error: v.error }
      const entrada: CuentaEntrada = v.valor

      const asignar = (cuentaId: string | null) =>
        tx
          .update(sucursales)
          .set({ cuentaAlegraId: cuentaId, updatedAt: new Date() })
          .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.slug, slugSucursal)))

      if (entrada.modo === "ninguna") {
        await asignar(null)
        return { kind: "ok", cuenta: null }
      }

      if (entrada.modo === "principal") {
        const principal = await principalDe(tx, tenantId)
        let fila = principal
        if (entrada.cuit !== undefined) {
          ;[fila] = await tx
            .update(alegraCuentas)
            .set({ cuit: entrada.cuit, updatedAt: new Date() })
            .where(eq(alegraCuentas.id, principal.id))
            .returning()
        }
        await asignar(fila.id)
        return { kind: "ok", cuenta: toCuentaDto(fila, await credencialesDelTenant(tenantId)) }
      }

      // modo "propia"
      let fila: CuentaRow
      if (propiaActual) {
        ;[fila] = await tx
          .update(alegraCuentas)
          .set({
            ...(entrada.email !== undefined ? { alegraEmail: entrada.email } : {}),
            ...(entrada.token !== undefined ? { alegraToken: entrada.token } : {}),
            ...(entrada.cuit !== undefined ? { cuit: entrada.cuit } : {}),
            ...(entrada.nombre !== undefined ? { nombre: entrada.nombre } : {}),
            updatedAt: new Date(),
          })
          .where(eq(alegraCuentas.id, propiaActual.id))
          .returning()
      } else {
        const slugCuenta = slugDeCuenta(slugSucursal)
        const [ocupante] = await tx
          .select()
          .from(alegraCuentas)
          .where(and(eq(alegraCuentas.tenantId, tenantId), eq(alegraCuentas.slug, slugCuenta)))
        if (ocupante?.principal) {
          return { kind: "conflict", campo: "general", error: "El identificador de esta sucursal está reservado para la cuenta principal." }
        }
        if (ocupante) {
          const [usadaPor] = await tx
            .select({ slug: sucursales.slug })
            .from(sucursales)
            .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.cuentaAlegraId, ocupante.id)))
          if (usadaPor) {
            return { kind: "conflict", campo: "general", error: "Ya existe una cuenta de Alegra con ese identificador asignada a otra sucursal." }
          }
          // Cuenta propia que quedó sin asignar (se quitó antes): se reutiliza con las credenciales nuevas.
          ;[fila] = await tx
            .update(alegraCuentas)
            .set({
              alegraEmail: entrada.email ?? "",
              alegraToken: entrada.token ?? "",
              cuit: entrada.cuit ?? ocupante.cuit,
              nombre: entrada.nombre ?? ocupante.nombre,
              updatedAt: new Date(),
            })
            .where(eq(alegraCuentas.id, ocupante.id))
            .returning()
        } else {
          ;[fila] = await tx
            .insert(alegraCuentas)
            .values({
              tenantId,
              slug: slugCuenta,
              nombre: entrada.nombre ?? suc.nombre,
              cuit: entrada.cuit ?? "",
              alegraEmail: entrada.email ?? "",
              alegraToken: entrada.token ?? "",
            })
            .returning()
        }
      }
      await asignar(fila.id)
      return { kind: "ok", cuenta: toCuentaDto(fila) }
    })
  } catch (err) {
    if (codigoPg(err) === "23505") return { kind: "conflict", campo: "general", error: MSG_CONCURRENCIA }
    throw err
  }
}

export type ResultadoConfig =
  | { kind: "ok"; config: TenantConfig }
  | { kind: "sin_cuenta"; error: string }
  | { kind: "not_found" }

/**
 * TenantConfig para hablar con Alegra desde una sucursal (uso interno; NUNCA se serializa hacia
 * el cliente). Resuelve la cuenta asignada; sin cuenta, fuera de producción, cae al fallback de
 * desarrollo por variables de entorno (ver sucursales-cuenta.ts).
 *
 * `override` permite probar credenciales antes de guardarlas (correo/token del formulario); el
 * token guardado se usa cuando el formulario no trae uno nuevo.
 */
export async function configDeSucursal(
  tenantId: string,
  slugSucursal: string,
  override?: { email?: string; token?: string },
): Promise<ResultadoConfig> {
  const db = getDb()
  const [suc] = await db
    .select()
    .from(sucursales)
    .where(and(eq(sucursales.tenantId, tenantId), eq(sucursales.slug, slugSucursal)))
  if (!suc) return { kind: "not_found" }
  const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  if (!tenantRow) return { kind: "not_found" }
  const base = tenantConfigFromRow(tenantRow)

  const [cuenta] = suc.cuentaAlegraId
    ? await db
        .select()
        .from(alegraCuentas)
        .where(and(eq(alegraCuentas.tenantId, tenantId), eq(alegraCuentas.id, suc.cuentaAlegraId)))
    : []

  try {
    if (cuenta && (cuenta.principal || !override || (!override.email && !override.token))) {
      return { kind: "ok", config: configParaCuenta(base, cuenta as CuentaCredenciales) }
    }
    if (override && (override.email || override.token)) {
      // Prueba de credenciales antes de guardar: lo que no venga se completa con lo guardado.
      const email = override.email || cuenta?.alegraEmail || ""
      const token = override.token || cuenta?.alegraToken || ""
      if (email && token) return { kind: "ok", config: { ...base, alegraEmail: email, alegraToken: token, alegraMock: false } }
    }
    return { kind: "ok", config: configParaSucursalSinCuenta(base, slugSucursal) }
  } catch (err) {
    return { kind: "sin_cuenta", error: err instanceof Error ? err.message : MSG_SIN_CUENTA }
  }
}
