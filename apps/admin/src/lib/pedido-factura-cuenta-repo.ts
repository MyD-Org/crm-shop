import { and, asc, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas, pedidoFacturaCuenta, sucursales, tenants } from "@/db/schema"
import { escribirFacturaCruzadaShop } from "./factura-cruzada-shop"
import { parseInfoPago } from "./pago-en-linea"
import type { PedidoRow } from "./pedidos-repo"
import {
  configParaCuenta,
  cuentasAlegraRepetidas,
  esFacturaCruzada,
  resolverCuentaFactura,
  textoMotivoCuentaFactura,
  type CuentaCredenciales,
  type MotivoCuentaFactura,
  type SucursalCuentaDato,
} from "./sucursales-cuenta"
import { nombreProvincia } from "./sucursales-texto"
import type { CuentaDestino } from "./alegra-items-cuenta"
import type { TenantConfig } from "./tenants"

// Cuenta de Alegra que factura un pedido (change `sucursales-igz-mdp`, rebanada D, lote 3).
// Todo filtra por `tenantId` del guard. La tabla `pedido_factura_cuenta` es del CRM (ver su
// comentario en schema.ts); el DEFAULT se calcula, sólo la elección del operador y la cuenta con la
// que se emitió se guardan. Nada de esto viaja el token: los DTO llevan slug y nombre.

type CuentaRow = typeof alegraCuentas.$inferSelect
type FilaPfc = typeof pedidoFacturaCuenta.$inferSelect

export const MSG_CUENTA_INEXISTENTE = "La cuenta de Alegra seleccionada no existe o está inactiva."
export const MSG_SIN_CUENTA_FACTURA = "El pedido no tiene una cuenta de Alegra para facturar. Seleccione una."

export interface ContextoCuentaFactura {
  cuentas: CuentaRow[]
  sucursales: (SucursalCuentaDato & { nombre: string; activa?: boolean })[]
  principalId: string | null
  fila: FilaPfc | null
}

/**
 * Los tenants dados de alta después de la migración 0042 no tienen fila de cuenta principal: se la
 * crea acá (idempotente; sin credenciales propias, usa las del tenant), igual que hace el repo de
 * cuentas. Sin ella un pedido sin sucursal no tendría con qué cuenta facturarse.
 */
async function asegurarPrincipal(tenantId: string): Promise<void> {
  const db = getDb()
  const [existe] = await db
    .select({ id: alegraCuentas.id })
    .from(alegraCuentas)
    .where(and(eq(alegraCuentas.tenantId, tenantId), eq(alegraCuentas.principal, true)))
  if (existe) return
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId))
  await db
    .insert(alegraCuentas)
    .values({ tenantId, slug: "principal", nombre: t?.name ?? "Cuenta principal", principal: true })
    .onConflictDoNothing()
}

export async function cargarContextoCuentaFactura(tenantId: string, orderId: string): Promise<ContextoCuentaFactura> {
  const db = getDb()
  await asegurarPrincipal(tenantId)
  const [cuentas, suc, [fila]] = await Promise.all([
    db.select().from(alegraCuentas).where(eq(alegraCuentas.tenantId, tenantId)).orderBy(asc(alegraCuentas.principal), asc(alegraCuentas.slug)),
    db
      .select({ slug: sucursales.slug, nombre: sucursales.nombre, cuentaAlegraId: sucursales.cuentaAlegraId, activa: sucursales.activa })
      .from(sucursales)
      .where(eq(sucursales.tenantId, tenantId))
      .orderBy(asc(sucursales.orden)),
    db
      .select()
      .from(pedidoFacturaCuenta)
      .where(and(eq(pedidoFacturaCuenta.tenantId, tenantId), eq(pedidoFacturaCuenta.orderId, orderId))),
  ])
  // Invariante: una cuenta de Alegra por sucursal. Si se rompe, el aviso de cobro no distingue.
  for (const r of cuentasAlegraRepetidas(suc)) {
    console.error("[pedido-factura-cuenta] una cuenta de Alegra está asignada a más de una sucursal activa", { tenant: tenantId, ...r })
  }
  return {
    cuentas,
    sucursales: suc,
    principalId: cuentas.find((c) => c.principal)?.id ?? null,
    fila: fila ?? null,
  }
}

/** Campos del pedido que hacen falta para saber con qué cuenta se cobró en línea (todos opcionales). */
export type PedidoConCobro = Pick<PedidoRow, "sucursal" | "sucursalRegla"> &
  Partial<Pick<PedidoRow, "pagoEstado" | "pagoProveedor" | "pagoInfo">>

export interface AvisoCobroDto {
  /** Sucursal cuya cuenta del procesador (Mercado Pago / Payway) cobró el pago. */
  cobradoCon: { slug: string; nombre: string }
  /** Cuenta de Alegra con la que se va a facturar. */
  facturaCon: { slug: string; nombre: string }
}

/**
 * Aviso (NO bloqueante) cuando el pedido se cobró en línea con la cuenta de una sucursal y se va a
 * facturar con una cuenta de Alegra que no es la de esa sucursal (mapeo 1 a 1:
 * `sucursales.cuentaAlegraId`). Sin pago en línea aprobado, sin `cuentaCobro` (pagos anteriores),
 * sin sucursal de cobro conocida o sin cuenta de Alegra en ella → null: no hay con qué comparar.
 */
export function avisoCobroDelPedido(
  pedido: PedidoConCobro,
  ctx: ContextoCuentaFactura,
  cuentaFactura: Pick<CuentaRow, "id" | "slug" | "nombre"> | null,
): AvisoCobroDto | null {
  if (!cuentaFactura || pedido.pagoEstado !== "pagado" || pedido.pagoProveedor == null) return null
  const slugCobro = parseInfoPago(pedido.pagoInfo).cuentaCobro
  if (!slugCobro) return null
  const sucursalCobro = ctx.sucursales.find((s) => s.slug === slugCobro)
  if (!sucursalCobro?.cuentaAlegraId || sucursalCobro.cuentaAlegraId === cuentaFactura.id) return null
  return {
    cobradoCon: { slug: sucursalCobro.slug, nombre: sucursalCobro.nombre },
    facturaCon: { slug: cuentaFactura.slug, nombre: cuentaFactura.nombre },
  }
}

export interface ResolucionPedido {
  cuenta: CuentaRow | null
  motivo: MotivoCuentaFactura
  cruzada: boolean
}

/**
 * La cuenta que factura el pedido. `eleccionSlug` = cuenta pedida en la request (vista previa o
 * confirmación); undefined = la guardada en el pedido o la calculada. Una cuenta pedida que no
 * existe o está inactiva da `cuenta: null` con motivo `sin_cuenta`.
 */
export function resolverParaPedido(
  pedido: Pick<PedidoRow, "sucursal" | "sucursalRegla">,
  ctx: ContextoCuentaFactura,
  eleccionSlug?: string | null,
): ResolucionPedido {
  const activas = ctx.cuentas.filter((c) => c.activa)
  let override = ctx.fila?.cuentaOverrideId ?? null
  if (eleccionSlug) {
    const elegida = activas.find((c) => c.slug === eleccionSlug)
    if (!elegida) return { cuenta: null, motivo: "sin_cuenta", cruzada: false }
    override = elegida.id
  }
  const res = resolverCuentaFactura({
    override,
    facturaSucursal: pedido.sucursalRegla?.facturaSucursal ?? null,
    sucursalDespacho: pedido.sucursal,
    sucursales: ctx.sucursales,
    cuentaPrincipalId: ctx.principalId,
  })
  const cuenta = res.cuentaId ? (activas.find((c) => c.id === res.cuentaId) ?? null) : null
  return {
    cuenta,
    motivo: cuenta ? res.motivo : "sin_cuenta",
    cruzada: cuenta
      ? esFacturaCruzada({
          cuentaFacturaId: cuenta.id,
          sucursalDespacho: pedido.sucursal,
          sucursales: ctx.sucursales,
          cuentaPrincipalId: ctx.principalId,
        })
      : false,
  }
}

/** La cuenta como destino de una factura/remito. */
export const comoDestino = (c: CuentaRow): CuentaDestino => ({ id: c.id, slug: c.slug, nombre: c.nombre, principal: c.principal })

/** TenantConfig para hablar con la cuenta; lanza (mensaje en usted) si no tiene credenciales. */
export const configDeCuentaRow = (base: TenantConfig, c: CuentaRow): TenantConfig =>
  configParaCuenta(base, c as CuentaCredenciales)

// ── DTO del detalle del pedido ──

export interface CuentaFacturaDto {
  /** Cuentas activas entre las que puede elegir un admin. */
  cuentas: { slug: string; nombre: string; principal: boolean }[]
  /** La que factura ahora (la elegida, o la calculada). null = hay que elegir una. */
  efectiva: { slug: string; nombre: string; motivo: MotivoCuentaFactura; texto: string } | null
  /** Sucursal que despacha y su cuenta (para explicar la venta entre empresas). */
  despacha: { sucursal: string | null; cuentaNombre: string | null }
  cruzada: boolean
  /** Auditoría de la elección del operador. */
  override: { por: string | null; en: string; anterior: string | null } | null
  /** Cuenta con la que YA se emitió la factura (si el pedido está facturado por esta vía). */
  emitida: { slug: string; nombre: string; cruzada: boolean } | null
  /** false cuando la factura ya se emitió: la cuenta ya no se puede cambiar. */
  editable: boolean
  /**
   * Se cobró en línea con la cuenta de una sucursal y se va a facturar con otra: pide confirmación
   * (no bloquea; por eso NO va en `avisos[]` del preview). Ausente/null = sin aviso.
   */
  avisoCobro?: AvisoCobroDto | null
}

export function armarCuentaFacturaDto(
  pedido: PedidoConCobro,
  ctx: ContextoCuentaFactura,
  facturado: boolean,
  /** Cuenta pedida en la request (vista previa), todavía sin guardar. */
  eleccionSlug?: string | null,
): CuentaFacturaDto {
  const activas = ctx.cuentas.filter((c) => c.activa)
  const res = resolverParaPedido(pedido, ctx, eleccionSlug)
  const provincia = nombreProvincia(pedido.sucursalRegla?.provincia ?? null)
  const nombreCuenta = (id: string | null | undefined) => (id ? (ctx.cuentas.find((c) => c.id === id)?.nombre ?? null) : null)
  const cuentaDespachoId = pedido.sucursal
    ? (ctx.sucursales.find((s) => s.slug === pedido.sucursal)?.cuentaAlegraId ?? null)
    : ctx.principalId
  const f = ctx.fila
  const emitidaCuenta = f?.facturaCuentaId ? ctx.cuentas.find((c) => c.id === f.facturaCuentaId) : undefined
  return {
    cuentas: activas.map((c) => ({ slug: c.slug, nombre: c.nombre, principal: c.principal })),
    efectiva: res.cuenta
      ? {
          slug: res.cuenta.slug,
          nombre: res.cuenta.nombre,
          motivo: res.motivo,
          texto: textoMotivoCuentaFactura(res.motivo, provincia),
        }
      : null,
    despacha: {
      sucursal: pedido.sucursal ? (ctx.sucursales.find((s) => s.slug === pedido.sucursal)?.nombre ?? pedido.sucursal) : null,
      cuentaNombre: nombreCuenta(cuentaDespachoId),
    },
    cruzada: emitidaCuenta ? f!.facturaCruzada : res.cruzada,
    override: f?.cuentaOverrideId && f.overrideEn
      ? { por: f.overridePorNombre, en: f.overrideEn.toISOString(), anterior: nombreCuenta(f.overrideAnteriorId) }
      : null,
    emitida: emitidaCuenta ? { slug: emitidaCuenta.slug, nombre: emitidaCuenta.nombre, cruzada: f!.facturaCruzada } : null,
    editable: !facturado,
    avisoCobro: facturado ? null : avisoCobroDelPedido(pedido, ctx, res.cuenta),
  }
}

// ── Escrituras ──

/**
 * Guarda la cuenta elegida por el operador con su auditoría (quién, cuándo, cuenta anterior). Si
 * la elegida es la que ya estaba, no hace nada (no ensucia la auditoría).
 */
export async function guardarCuentaElegida(
  tenantId: string,
  orderId: string,
  input: { cuentaId: string; anteriorId: string | null; actor: { id: string; name: string }; now: Date },
): Promise<void> {
  await getDb()
    .insert(pedidoFacturaCuenta)
    .values({
      tenantId,
      orderId,
      cuentaOverrideId: input.cuentaId,
      overridePor: input.actor.id,
      overridePorNombre: input.actor.name,
      overrideEn: input.now,
      overrideAnteriorId: input.anteriorId,
    })
    .onConflictDoUpdate({
      target: [pedidoFacturaCuenta.tenantId, pedidoFacturaCuenta.orderId],
      set: {
        cuentaOverrideId: input.cuentaId,
        overridePor: input.actor.id,
        overridePorNombre: input.actor.name,
        overrideEn: input.now,
        overrideAnteriorId: input.anteriorId,
        updatedAt: input.now,
      },
      // Misma cuenta que ya estaba elegida: no se reescribe la auditoría.
      setWhere: sql`${pedidoFacturaCuenta.cuentaOverrideId} is distinct from ${input.cuentaId}::uuid`,
    })
}

/**
 * Deja asentada la cuenta con la que se emitió la factura y si fue cruzada. Las dos escrituras
 * (`public.pedido_factura_cuenta` y la marca `shop.orders.factura_cruzada` que lee la vista de
 * reserva) van en UNA transacción (misma base): si falla la segunda no queda la primera, y la
 * reserva de un pedido cruzado no se libera antes de tiempo.
 */
export async function registrarFacturaCuenta(
  tenantId: string,
  orderId: string,
  input: { cuentaId: string; cruzada: boolean; now: Date },
): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx
      .insert(pedidoFacturaCuenta)
      .values({ tenantId, orderId, facturaCuentaId: input.cuentaId, facturaCruzada: input.cruzada })
      .onConflictDoUpdate({
        target: [pedidoFacturaCuenta.tenantId, pedidoFacturaCuenta.orderId],
        set: { facturaCuentaId: input.cuentaId, facturaCruzada: input.cruzada, updatedAt: input.now },
      })
    // Misma marca en `shop.orders`: la lee la vista de reserva.
    await escribirFacturaCruzadaShop(tenantId, orderId, input.cruzada, tx)
  })
}

/** Al desvincular la factura la cuenta con la que se emitió deja de valer (la elección se conserva). */
export async function limpiarFacturaCuenta(tenantId: string, orderId: string, ej: Pick<ReturnType<typeof getDb>, "update"> = getDb()): Promise<void> {
  await ej
    .update(pedidoFacturaCuenta)
    .set({ facturaCuentaId: null, facturaCruzada: false, updatedAt: new Date() })
    .where(and(eq(pedidoFacturaCuenta.tenantId, tenantId), eq(pedidoFacturaCuenta.orderId, orderId)))
  // Y la marca del Shop vuelve a false: sin factura no hay factura cruzada.
  await escribirFacturaCruzadaShop(tenantId, orderId, false, ej)
}
