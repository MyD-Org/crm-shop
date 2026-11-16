import {
  borrarBill,
  buscarBills,
  clasificarErrorEscritura,
  crearBill,
  leerBill,
  listarAlmacenes,
  listarCategoriasContables,
  reemplazarLineasBill,
  reemplazarPercepcionesBill,
  resolverCategoriaTransito,
  type BillLeida,
  type PercepcionEscritura,
} from "./alegra-compras"
import { AlegraHttpError, listTaxes, type AlegraTax } from "./alegra"
import { msgProductoSinItemEnCuenta, resolverIdsEnCuentaSinCrear, type ResolucionSinCrear } from "./alegra-items-cuenta"
import {
  configAlegraDeCuenta,
  cuentaActivaPorSlug,
  cuentaPorId,
  MSG_CUENTA_NO_EXISTE,
  obtenerConfigCompras,
  type ConfigComprasFila,
  type CuentaFila,
} from "./compras-config-repo"
import { ErrorCompras, e5ACentavos, ivaBpDePorcentaje, subtotalExactoE5 } from "./compras-dinero"
import { validarEntradaCompra, type EntradaCompra } from "./compras-entrada"
import { transicionar, evaluarGuardas, type EstadoCompra } from "./compras-estado"
import { productosPorAlegraId, type ProductoBasico } from "./compras-productos-repo"
import {
  actualizarCompra,
  compraPorIdempotencia,
  conLockCompra,
  crearCompra,
  descartarCompraCreando,
  obtenerCompra,
  reemplazarDetalle,
  type CompraCompleta,
  type NuevaPercepcion,
  type NuevoItem,
} from "./compras-repo"
import {
  construirLineasCreacion,
  hashSnapshot,
  normalizarSnapshot,
  totalEsperadoCentavos,
  type ItemReparto,
} from "./compras-reparto"
import { elegirImpuestoParaLinea } from "./factura-emitir"
import type { TenantConfig } from "./tenants"

// Orquestación de Compras: crear, editar y anular (change `compras-en-transito`, S4).
//
// ÚNICO módulo que escribe facturas de compra en Alegra. Patrón fijo "intención -> Alegra ->
// confirmación":
//   1. la compra se persiste en 'creando' (con clave de idempotencia) ANTES de tocar Alegra;
//   2. se llama a Alegra SIN transacción abierta (sólo se reintenta un 429; un 5xx o un corte
//      puede haber aplicado el cambio, así que se reconcilia leyendo la bill);
//   3. una transacción corta confirma ('pendiente' + snapshot de las líneas).
// Nunca se crean ítems en Alegra: los ids se resuelven en la cuenta destino SIN crear.
// El costo promedio lo recalcula Alegra (no por compras, según el sondeo): acá jamás se escribe un costo.

export interface DepsCompras {
  cuentaPorSlug: (tenantId: string, slug: string) => Promise<CuentaFila | null>
  cuentaPorId: (tenantId: string, id: string) => Promise<CuentaFila | null>
  configAlegra: (tenantId: string, cuenta: CuentaFila) => Promise<TenantConfig>
  configCompras: (tenantId: string, cuentaId: string) => Promise<ConfigComprasFila | null>
  resolverItems: (tenantId: string, cuenta: CuentaFila, ids: string[]) => Promise<ResolucionSinCrear>
  productos: (tenantId: string, ids: string[]) => Promise<Map<string, ProductoBasico>>
  impuestos: (config: TenantConfig) => Promise<AlegraTax[]>
  alegra: {
    listarCategoriasContables: typeof listarCategoriasContables
    listarAlmacenes: typeof listarAlmacenes
    crearBill: typeof crearBill
    leerBill: typeof leerBill
    reemplazarLineasBill: typeof reemplazarLineasBill
    reemplazarPercepcionesBill: typeof reemplazarPercepcionesBill
    borrarBill: typeof borrarBill
    buscarBills: typeof buscarBills
  }
}

export const DEPS_REALES: DepsCompras = {
  cuentaPorSlug: cuentaActivaPorSlug,
  cuentaPorId,
  configAlegra: configAlegraDeCuenta,
  configCompras: obtenerConfigCompras,
  resolverItems: (tenantId, cuenta, ids) =>
    resolverIdsEnCuentaSinCrear(tenantId, { id: cuenta.id, slug: cuenta.slug, nombre: cuenta.nombre, principal: cuenta.principal }, ids),
  productos: productosPorAlegraId,
  impuestos: listTaxes,
  alegra: {
    listarCategoriasContables,
    listarAlmacenes,
    crearBill,
    leerBill,
    reemplazarLineasBill,
    reemplazarPercepcionesBill,
    borrarBill,
    buscarBills,
  },
}

export type EstadoCreacion = "pendiente" | "creando"

export interface ResultadoCreacion {
  compraId: string
  estado: EstadoCreacion
  /** true si no se pudo confirmar con Alegra: la compra queda bloqueada hasta verificarla. */
  incierta: boolean
  aviso?: string
}

const MSG_INCIERTA =
  "No pudimos confirmar con Alegra si la factura se registró. La compra quedó pendiente de verificación: ábrala en unos minutos y se comprobará automáticamente. No la cargue de nuevo."
const MSG_NO_MODIFICABLE = "La compra ya tiene mercadería recibida y no puede modificarse ni anularse."
const MSG_PAGOS_ANULAR = "Esta factura ya tiene un pago registrado en Alegra. Anúlela directamente en Alegra."
const MSG_PAGOS_EDITAR = "Esta factura ya tiene un pago registrado en Alegra. Modifíquela directamente en Alegra."

/** Detalle del rechazo de Alegra, apto para mostrar (sin rutas ni credenciales). */
function detalleAlegra(e: unknown): string {
  if (e instanceof AlegraHttpError) {
    const d = /: ([\s\S]+)$/.exec(e.message)?.[1]?.replace(/\s+/g, " ").trim()
    return d ? ` (código ${e.status}: ${d.slice(0, 200)})` : ` (código ${e.status})`
  }
  return ""
}

const rechazoAlegra = (e: unknown) =>
  new ErrorCompras("alegra_rechazo", `Alegra no aceptó la operación${detalleAlegra(e)}. Revise los datos e inténtelo nuevamente.`)

const marcadorDe = (compraId: string) => `[CRM compra:${compraId.slice(0, 8)}]`

// ── Preparación (pura salvo lecturas) ─────────────────────────────────────────────────────────────

interface Contexto {
  cuenta: CuentaFila
  config: TenantConfig
  cfg: ConfigComprasFila | null
}

async function contexto(tenantId: string, slug: string, deps: DepsCompras): Promise<Contexto> {
  const cuenta = await deps.cuentaPorSlug(tenantId, slug)
  if (!cuenta) throw new ErrorCompras("cuenta_inexistente", MSG_CUENTA_NO_EXISTE)
  return contextoDeCuenta(tenantId, cuenta, deps)
}

async function contextoDeCuenta(tenantId: string, cuenta: CuentaFila, deps: DepsCompras): Promise<Contexto> {
  let config: TenantConfig
  try {
    config = await deps.configAlegra(tenantId, cuenta)
  } catch {
    throw new ErrorCompras("sin_credenciales", "La cuenta de Alegra seleccionada no tiene credenciales cargadas.")
  }
  return { cuenta, config, cfg: await deps.configCompras(tenantId, cuenta.id) }
}

interface Preparada {
  transitoId: string
  almacenId: string
  items: NuevoItem[]
  reparto: ItemReparto[]
  lineas: ReturnType<typeof construirLineasCreacion>
  percepciones: NuevaPercepcion[]
  percepcionesAlegra: PercepcionEscritura[]
  netoCentavos: number
  ivaCentavos: number
  percepcionesCentavos: number
  totalCentavos: number
}

async function preparar(tenantId: string, entrada: EntradaCompra, ctx: Contexto, deps: DepsCompras): Promise<Preparada> {
  const { cuenta, config, cfg } = ctx

  const cats = await deps.alegra.listarCategoriasContables(config)
  const transito = resolverCategoriaTransito(cats, { overrideId: cfg?.categoriaTransitoId ?? undefined })
  if (!transito.ok) {
    throw new ErrorCompras(
      "sin_transito",
      transito.motivo === "ambigua"
        ? "Hay más de una cuenta «Mercadería en tránsito» en la cuenta de Alegra seleccionada. Indique cuál usar en la configuración de Compras."
        : 'No se encontró la cuenta "Mercadería en tránsito" en la cuenta de Alegra seleccionada. Configúrela antes de continuar.',
    )
  }

  let almacenId = cfg?.almacenId ?? null
  if (!almacenId) {
    const almacenes = await deps.alegra.listarAlmacenes(config)
    almacenId = (almacenes.find((a) => a.porDefecto) ?? almacenes[0])?.id ?? null
  }
  if (!almacenId) throw new ErrorCompras("sin_almacen", "No se encontró un depósito en la cuenta de Alegra seleccionada.")

  const ids = entrada.items.map((i) => i.alegraId)
  const [productos, resolucion, impuestos] = await Promise.all([
    deps.productos(tenantId, ids),
    deps.resolverItems(tenantId, cuenta, ids),
    deps.impuestos(config),
  ])
  for (const id of ids) {
    const p = productos.get(id)
    if (!p) throw new ErrorCompras("producto_inexistente", "Uno de los productos ya no está en el catálogo. Quítelo de la compra.")
    if (!resolucion.ids.has(id)) {
      throw new ErrorCompras(
        "item_inexistente",
        msgProductoSinItemEnCuenta(p.nombre, { id: cuenta.id, slug: cuenta.slug, nombre: cuenta.nombre, principal: cuenta.principal }),
      )
    }
  }

  const reparto: ItemReparto[] = []
  const items: NuevoItem[] = []
  for (const it of entrada.items) {
    const impuesto = elegirImpuestoParaLinea(impuestos, it.ivaPorcentaje)
    if (!impuesto) {
      throw new ErrorCompras(
        "impuesto_sin_mapear",
        `No hay un impuesto activo con ${it.ivaPorcentaje} % de IVA en la cuenta de Alegra seleccionada. Revise los impuestos de la cuenta.`,
      )
    }
    const p = productos.get(it.alegraId)!
    const itemIdCuenta = resolucion.ids.get(it.alegraId)!
    reparto.push({
      itemIdCuenta,
      costoCentavos: it.costoCentavos,
      cantidadPedidaMilesimas: it.cantidadMilesimas,
      taxId: impuesto.alegraId,
      ivaBp: ivaBpDePorcentaje(it.ivaPorcentaje),
    })
    items.push({
      alegraId: it.alegraId,
      itemIdCuenta,
      codigo: p.codigo,
      nombre: p.nombre,
      cantidadPedida: (it.cantidadMilesimas / 1000).toFixed(3),
      costoUnitarioCentavos: it.costoCentavos,
      ivaPorcentaje: it.ivaPorcentaje.toFixed(2),
      taxAlegraId: impuesto.alegraId,
      netoE5: Number(subtotalExactoE5(it.costoCentavos, it.cantidadMilesimas)),
    })
  }

  const mapaPerc = cfg?.percepciones ?? {}
  const percepciones: NuevaPercepcion[] = []
  const percepcionesAlegra: PercepcionEscritura[] = []
  for (const p of entrada.percepciones) {
    const idPerception = mapaPerc[p.nombre]
    if (!idPerception) {
      throw new ErrorCompras(
        "percepcion_sin_configurar",
        `La percepción «${p.nombre}» no está configurada para la cuenta de Alegra seleccionada. Configúrela antes de continuar.`,
      )
    }
    percepciones.push({ alegraPerceptionId: idPerception, nombre: p.nombre, importeCentavos: p.importeCentavos, numeroCertificado: p.certificado })
    percepcionesAlegra.push({ idPerception, importeCentavos: p.importeCentavos, certificado: p.certificado })
  }

  // El dominio puro fija las líneas y el total: mismas funciones que usarán las recepciones.
  const lineas = construirLineasCreacion(reparto, transito.id)
  const percepcionesCentavos = entrada.percepciones.reduce((a, p) => a + p.importeCentavos, 0)
  const totalCentavos = totalEsperadoCentavos(reparto, entrada.percepciones.map((p) => p.importeCentavos))
  const netoCentavos = e5ACentavos(items.reduce((a, i) => a + BigInt(i.netoE5), BigInt(0)))
  const ivaCentavos = totalCentavos - percepcionesCentavos - netoCentavos
  return {
    transitoId: transito.id,
    almacenId,
    items,
    reparto,
    lineas,
    percepciones,
    percepcionesAlegra,
    netoCentavos,
    ivaCentavos,
    percepcionesCentavos,
    totalCentavos,
  }
}

// ── Crear ─────────────────────────────────────────────────────────────────────────────────────────

/** Valida el body crudo y crea la compra. Errores de validación -> ErrorCompras('validacion'). */
export async function crearCompraDesdeBody(
  tenantId: string,
  usuarioId: string | null,
  raw: unknown,
  deps: DepsCompras = DEPS_REALES,
): Promise<ResultadoCreacion> {
  const v = validarEntradaCompra(raw)
  if (!v.ok) throw new ErrorCompras("validacion", v.error)
  return crearCompraService(tenantId, usuarioId, v.value, deps)
}

export async function crearCompraService(
  tenantId: string,
  usuarioId: string | null,
  entrada: EntradaCompra,
  deps: DepsCompras = DEPS_REALES,
): Promise<ResultadoCreacion> {
  // Idempotencia: el mismo comando repetido devuelve lo ya hecho sin volver a llamar a Alegra.
  const previa = await compraPorIdempotencia(tenantId, entrada.idempotencyKey)
  if (previa && previa.estado !== "creando") {
    return { compraId: previa.id, estado: "pendiente", incierta: false }
  }

  const ctx = await contexto(tenantId, entrada.cuenta, deps)
  const prep = await preparar(tenantId, entrada, ctx, deps)

  const { id, creada } = await crearCompra(tenantId, {
    cuentaId: ctx.cuenta.id,
    proveedorAlegraId: entrada.proveedor.id,
    proveedorNombre: entrada.proveedor.nombre,
    proveedorCuit: entrada.proveedor.cuit,
    numeroFactura: entrada.numeroFactura,
    fecha: entrada.fecha,
    vencimiento: entrada.vencimiento,
    observaciones: entrada.observaciones,
    almacenId: prep.almacenId,
    idempotencyKey: entrada.idempotencyKey,
    creadaPor: usuarioId,
    netoCentavos: prep.netoCentavos,
    ivaCentavos: prep.ivaCentavos,
    percepcionesCentavos: prep.percepcionesCentavos,
    totalCentavos: prep.totalCentavos,
    items: prep.items,
    percepciones: prep.percepciones,
  })
  const compra = (await obtenerCompra(tenantId, id))!
  if (compra.estado !== "creando") return { compraId: id, estado: "pendiente", incierta: false }

  const marcador = marcadorDe(id)
  const observaciones = [entrada.observaciones, marcador].filter(Boolean).join(" ")
  let bill: BillLeida | null = null

  if (compra.alegraBillId) {
    bill = await deps.alegra.leerBill(ctx.config, compra.alegraBillId)
  } else if (!creada) {
    // Reintento de una creación que quedó en el aire: primero se busca la bill, nunca se postea a ciegas.
    try {
      const cand = await deps.alegra.buscarBills(ctx.config, { proveedorId: entrada.proveedor.id, numero: entrada.numeroFactura })
      bill = await adoptarCandidata(tenantId, id, cand, marcador)
    } catch (e) {
      if (e instanceof ErrorCompras) throw e
      return { compraId: id, estado: "creando", incierta: true, aviso: MSG_INCIERTA }
    }
  }

  if (!bill) {
    try {
      bill = await deps.alegra.crearBill(ctx.config, {
        proveedorId: entrada.proveedor.id,
        numero: entrada.numeroFactura,
        fecha: entrada.fecha,
        vencimiento: entrada.vencimiento,
        almacenId: prep.almacenId,
        observaciones,
        lineas: prep.lineas,
      })
    } catch (e) {
      if (clasificarErrorEscritura(e) !== "incierta") {
        // Alegra no la tomó: no queda compra a medias.
        await descartarCompraCreando(tenantId, id)
        throw rechazoAlegra(e)
      }
      try {
        const cand = await deps.alegra.buscarBills(ctx.config, { proveedorId: entrada.proveedor.id, numero: entrada.numeroFactura })
        bill = await adoptarCandidata(tenantId, id, cand, marcador)
      } catch (e2) {
        if (e2 instanceof ErrorCompras) throw e2
        bill = null
      }
      if (!bill) return { compraId: id, estado: "creando", incierta: true, aviso: MSG_INCIERTA }
    }
  }

  return finalizarCreacion(tenantId, compra, ctx.config, bill, prep.percepcionesAlegra, deps)
}

/** Adopta la bill creada por el CRM (marcador en las observaciones). Otra con el mismo número = error. */
async function adoptarCandidata(tenantId: string, compraId: string, cand: BillLeida[], marcador: string): Promise<BillLeida | null> {
  if (cand.length === 0) return null
  const propia = cand.find((b) => (b.observaciones ?? "").includes(marcador))
  if (propia) return propia
  await descartarCompraCreando(tenantId, compraId)
  throw new ErrorCompras(
    "bill_ajena",
    "Ya existe en Alegra una factura de este proveedor con ese número que no se cargó desde el CRM. Revísela en Alegra.",
  )
}

/** Deshace una bill recién creada (rollback) y libera el proveedor + número. true si quedó deshecha. */
async function deshacerBill(tenantId: string, compraId: string, config: TenantConfig, billId: string, deps: DepsCompras): Promise<boolean> {
  try {
    await deps.alegra.borrarBill(config, billId)
  } catch {
    return false
  }
  await conLockCompra(tenantId, compraId, async (tx, c) => {
    await actualizarCompra(tx, tenantId, compraId, { estado: transicionar(c.estado as EstadoCompra, "anulada", { transitoRestanteE5: BigInt(0) }), anuladaAt: new Date() })
  })
  return true
}

/**
 * Desde que hay bill en Alegra: guarda su id, aplica las percepciones, verifica el total y
 * confirma la compra ('pendiente' + snapshot). Si algo definitivo falla, intenta borrar la bill.
 */
async function finalizarCreacion(
  tenantId: string,
  compra: CompraCompleta,
  config: TenantConfig,
  bill: BillLeida | null,
  percepciones: PercepcionEscritura[],
  deps: DepsCompras,
): Promise<ResultadoCreacion> {
  const id = compra.id
  const incierta = (): ResultadoCreacion => ({ compraId: id, estado: "creando", incierta: true, aviso: MSG_INCIERTA })
  if (!bill) {
    // La bill guardada ya no existe en Alegra: se la borró afuera antes de confirmar.
    await conLockCompra(tenantId, id, async (tx, c) => {
      await actualizarCompra(tx, tenantId, id, { estado: transicionar(c.estado as EstadoCompra, "anulada", { transitoRestanteE5: BigInt(0) }), anuladaAt: new Date() })
    })
    throw new ErrorCompras("bill_borrada", "La factura ya no existe en Alegra. Cargue la compra nuevamente.")
  }
  if (compra.alegraBillId !== bill.id) {
    await conLockCompra(tenantId, id, (tx) => actualizarCompra(tx, tenantId, id, { alegraBillId: bill.id }))
  }

  let actual = bill
  if (percepciones.length > 0 && actual.totalCentavos !== compra.totalCentavos) {
    try {
      await deps.alegra.reemplazarPercepcionesBill(config, bill.id, percepciones)
    } catch (e) {
      if (clasificarErrorEscritura(e) === "incierta") return incierta()
      const deshecha = await deshacerBill(tenantId, id, config, bill.id, deps)
      if (!deshecha) return incierta()
      throw new ErrorCompras(
        "percepciones_rechazadas",
        `Alegra no aceptó las percepciones${detalleAlegra(e)}. La factura no se registró; revise las percepciones e inténtelo nuevamente.`,
      )
    }
    try {
      const releida = await deps.alegra.leerBill(config, bill.id)
      if (!releida) return incierta()
      actual = releida
    } catch {
      return incierta()
    }
  }

  if (actual.totalCentavos !== compra.totalCentavos) {
    const deshecha = await deshacerBill(tenantId, id, config, bill.id, deps)
    if (!deshecha) return incierta()
    throw new ErrorCompras(
      "total_distinto",
      "El total que calculó Alegra no coincide con el de la compra. La factura no se registró; revise los importes e inténtelo nuevamente.",
    )
  }

  const snapshot = normalizarSnapshot(actual.lineas, actual.totalCentavos)
  await conLockCompra(tenantId, id, async (tx, c) => {
    await actualizarCompra(tx, tenantId, id, {
      estado: transicionar(c.estado as EstadoCompra, "pendiente", { transitoRestanteE5: BigInt(0) }),
      alegraBillId: actual.id,
      snapshot,
      snapshotHash: hashSnapshot(snapshot),
    })
  })
  return { compraId: id, estado: "pendiente", incierta: false }
}

/**
 * Reconciliación de una compra en 'creando' (al abrir el detalle): busca/lee la bill y, si está
 * completa, confirma. Sólo LEE de Alegra salvo reaplicar las percepciones de una bill ya propia.
 */
export async function reconciliarCreacion(tenantId: string, compraId: string, deps: DepsCompras = DEPS_REALES): Promise<ResultadoCreacion | null> {
  const compra = await obtenerCompra(tenantId, compraId)
  if (!compra || compra.estado !== "creando") return null
  const cuenta = await deps.cuentaPorId(tenantId, compra.cuentaId)
  if (!cuenta) return null
  const ctx = await contextoDeCuenta(tenantId, cuenta, deps)
  let bill: BillLeida | null
  if (compra.alegraBillId) {
    bill = await deps.alegra.leerBill(ctx.config, compra.alegraBillId)
  } else {
    const cand = await deps.alegra.buscarBills(ctx.config, { proveedorId: compra.proveedorAlegraId, numero: compra.numeroFactura })
    bill = await adoptarCandidata(tenantId, compraId, cand, marcadorDe(compraId))
    if (!bill) return { compraId, estado: "creando", incierta: true, aviso: MSG_INCIERTA }
  }
  const percepciones: PercepcionEscritura[] = compra.percepcionesDetalle.map((p) => ({
    idPerception: p.alegraPerceptionId,
    importeCentavos: p.importeCentavos,
    certificado: p.numeroCertificado,
  }))
  return finalizarCreacion(tenantId, compra, ctx.config, bill, percepciones, deps)
}

/** Detalle de la compra; si quedó en 'creando' intenta reconciliarla primero (errores no cortan la lectura). */
export async function detalleCompra(tenantId: string, compraId: string, deps: DepsCompras = DEPS_REALES): Promise<CompraCompleta | null> {
  const c = await obtenerCompra(tenantId, compraId)
  if (!c) return null
  if (c.estado !== "creando") return c
  try {
    await reconciliarCreacion(tenantId, compraId, deps)
  } catch (e) {
    console.warn("[compras] no se pudo reconciliar la creación", { tenant: tenantId, compraId, e })
  }
  return obtenerCompra(tenantId, compraId)
}

// ── Editar y anular (sólo pendiente y sin recepciones) ────────────────────────────────────────────

function verificarModificable(c: CompraCompleta): void {
  if (c.desincronizada) {
    throw new ErrorCompras("desincronizada", "La compra no coincide con la factura de Alegra. Revise la factura en Alegra antes de continuar.")
  }
  const conRecepcion = c.recepciones.length > 0 || c.items.some((i) => Number(i.cantidadRecibida) > 0)
  if (c.estado !== "pendiente" || conRecepcion) {
    throw new ErrorCompras("no_modificable", c.estado === "pendiente" || c.estado === "parcial" ? MSG_NO_MODIFICABLE : "La compra ya no admite cambios.")
  }
}

const hashLineas = (lineas: Parameters<typeof normalizarSnapshot>[0]) => hashSnapshot(normalizarSnapshot(lineas, 0))

/** Edita ítems y percepciones (el encabezado de la factura no se modifica: para eso, anular y recrear). */
export async function editarCompraDesdeBody(
  tenantId: string,
  compraId: string,
  raw: unknown,
  deps: DepsCompras = DEPS_REALES,
): Promise<void> {
  const c = await obtenerCompra(tenantId, compraId)
  if (!c) throw new ErrorCompras("no_encontrada", "La compra no existe.")
  verificarModificable(c)
  const cuenta = await deps.cuentaPorId(tenantId, c.cuentaId)
  if (!cuenta) throw new ErrorCompras("cuenta_inexistente", MSG_CUENTA_NO_EXISTE)
  const body = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const v = validarEntradaCompra({
    cuenta: cuenta.slug,
    idempotencyKey: `edicion-${compraId}`,
    proveedor: { id: c.proveedorAlegraId, nombre: c.proveedorNombre, cuit: c.proveedorCuit },
    numeroFactura: c.numeroFactura,
    fecha: c.fecha,
    vencimiento: c.vencimiento,
    observaciones: c.observaciones,
    items: body.items,
    percepciones: body.percepciones,
  })
  if (!v.ok) throw new ErrorCompras("validacion", v.error)

  const ctx = await contextoDeCuenta(tenantId, cuenta, deps)
  const prep = await preparar(tenantId, v.value, ctx, deps)
  if (!c.alegraBillId || !c.snapshotHash) throw new ErrorCompras("sin_bill", "La compra todavía no se confirmó en Alegra.")

  const bill = await deps.alegra.leerBill(ctx.config, c.alegraBillId)
  if (!bill) {
    await conLockCompra(tenantId, compraId, (tx, cur) =>
      actualizarCompra(tx, tenantId, compraId, { estado: transicionar(cur.estado as EstadoCompra, "anulada_en_alegra", { transitoRestanteE5: BigInt(0) }) }),
    )
    throw new ErrorCompras("bill_borrada", "La factura ya no existe en Alegra. La compra quedó marcada como anulada en Alegra.")
  }
  const guardas = evaluarGuardas(bill, {
    snapshotHash: c.snapshotHash,
    totalEsperadoCentavos: c.totalCentavos,
    almacenId: c.almacenId,
    transitoPendiente: true,
    categoriaTransitoId: prep.transitoId,
  })
  if (!guardas.ok) {
    throw new ErrorCompras(guardas.codigo, guardas.codigo === "con_pagos" ? MSG_PAGOS_EDITAR : guardas.mensaje)
  }

  const marcarDesincronizada = () =>
    conLockCompra(tenantId, compraId, (tx) => actualizarCompra(tx, tenantId, compraId, { desincronizada: true })).catch(() => undefined)

  try {
    await deps.alegra.reemplazarLineasBill(ctx.config, c.alegraBillId, prep.lineas)
  } catch (e) {
    const clase = clasificarErrorEscritura(e)
    if (clase !== "incierta") throw rechazoAlegra(e)
    const releida = await deps.alegra.leerBill(ctx.config, c.alegraBillId).catch(() => null)
    if (releida && hashLineas(releida.lineas) === hashLineas(bill.lineas)) {
      throw new ErrorCompras("no_aplicada", "Alegra no aplicó el cambio. Inténtelo nuevamente.")
    }
    if (!releida || hashLineas(releida.lineas) !== hashLineas(prep.lineas)) {
      await marcarDesincronizada()
      throw new ErrorCompras("incierta", "No pudimos confirmar el cambio con Alegra. Revise la factura en Alegra antes de continuar.")
    }
  }

  try {
    await deps.alegra.reemplazarPercepcionesBill(ctx.config, c.alegraBillId, prep.percepcionesAlegra)
  } catch (e) {
    await marcarDesincronizada()
    throw new ErrorCompras("percepciones_rechazadas", `No se pudieron actualizar las percepciones en Alegra${detalleAlegra(e)}. Revise la factura en Alegra.`)
  }

  const final = await deps.alegra.leerBill(ctx.config, c.alegraBillId).catch(() => null)
  if (!final || final.totalCentavos !== prep.totalCentavos) {
    await marcarDesincronizada()
    throw new ErrorCompras("total_distinto", "El total que calculó Alegra no coincide con el de la compra. Revise la factura en Alegra.")
  }

  const snapshot = normalizarSnapshot(final.lineas, final.totalCentavos)
  await conLockCompra(tenantId, compraId, async (tx) => {
    await reemplazarDetalle(tx, tenantId, compraId, {
      netoCentavos: prep.netoCentavos,
      ivaCentavos: prep.ivaCentavos,
      percepcionesCentavos: prep.percepcionesCentavos,
      totalCentavos: prep.totalCentavos,
      items: prep.items,
      percepciones: prep.percepciones,
    })
    await actualizarCompra(tx, tenantId, compraId, { snapshot, snapshotHash: hashSnapshot(snapshot) })
  })
}

/** Anula la compra (DELETE de la bill). Sólo 'pendiente' y sin recepciones; con pagos se bloquea. */
export async function anularCompra(tenantId: string, compraId: string, deps: DepsCompras = DEPS_REALES): Promise<void> {
  const c = await obtenerCompra(tenantId, compraId)
  if (!c) throw new ErrorCompras("no_encontrada", "La compra no existe.")
  if (c.estado === "anulada") return
  verificarModificable(c)
  const cuenta = await deps.cuentaPorId(tenantId, c.cuentaId)
  if (!cuenta) throw new ErrorCompras("cuenta_inexistente", MSG_CUENTA_NO_EXISTE)
  const ctx = await contextoDeCuenta(tenantId, cuenta, deps)

  if (c.alegraBillId) {
    const bill = await deps.alegra.leerBill(ctx.config, c.alegraBillId)
    if (bill && bill.pagos.length > 0) throw new ErrorCompras("con_pagos", MSG_PAGOS_ANULAR)
    if (bill) {
      try {
        await deps.alegra.borrarBill(ctx.config, c.alegraBillId)
      } catch (e) {
        if (clasificarErrorEscritura(e) !== "incierta") throw rechazoAlegra(e)
        const sigue = await deps.alegra.leerBill(ctx.config, c.alegraBillId).catch(() => bill)
        if (sigue) {
          throw new ErrorCompras("incierta", "No pudimos confirmar con Alegra que la factura se anuló. Inténtelo nuevamente en unos minutos.")
        }
      }
    }
  }
  await conLockCompra(tenantId, compraId, async (tx, cur) => {
    await actualizarCompra(tx, tenantId, compraId, {
      estado: transicionar(cur.estado as EstadoCompra, "anulada", { transitoRestanteE5: BigInt(0) }),
      anuladaAt: new Date(),
    })
  })
}
