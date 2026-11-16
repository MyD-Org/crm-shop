import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import {
  crearItemCompra,
  buscarItemsPorCodigo,
  getItemParaEspejo,
  listPriceLists,
  listTaxes,
  type AlegraItemCompraInput,
  type AlegraPriceList,
  type AlegraProduct,
  type AlegraTax,
} from "./alegra"
import { encolar } from "./alegra-stock-cola"
import { asegurarItemsEnCuenta, type CuentaDestino, type DepsItemsCuenta } from "./alegra-items-cuenta"
import { normalizarCodigo } from "./alegra-pareo"
import { refrescarItemDeCuenta } from "./alegra-stock-cuenta"
import { upsertProductos } from "./catalog-products-repo"
import { escribirStockPrincipal } from "./catalogo-union-repo"
import { ErrorCompras } from "./compras-dinero"
import {
  aplicarPreciosElegidos,
  listasConAjuste,
  listasConDefecto,
  type ListaConPrecio,
  type PrecioElegido,
} from "./compras-listas-precio"
import { elegirImpuestoParaLinea } from "./factura-emitir"
import { getTenantById, type TenantConfig } from "./tenants"

// Alta y copia de productos desde Compras (change `compras-en-transito`, S4b). Sólo se escribe en
// la cuenta de Alegra de la compra y SIEMPRE tras una confirmación explícita (`confirmar: true`).
//
//  - «Copiar a <cuenta>»: el producto existe en el catálogo pero no en la cuenta. Usa la regla de
//    copia que ya usa la facturación en cuentas secundarias (`asegurarItemsEnCuenta`: busca por
//    código, no crea si hay uno, aborta con duplicados o variantes), pero con el alta completa
//    (costo, venta sin stock y TODAS las listas de precio).
//  - «Crear producto»: no existe en ninguna cuenta. Referencia = código del proveedor + "-" +
//    sufijo de marca (el sufijo lo indica el operador: no hay tabla de marcas -> sufijo).
//
// Idempotencia: lock advisory por (tenant, cuenta, referencia) + búsqueda por referencia en Alegra
// ANTES del POST: un doble clic no crea dos ítems.

export interface EntradaAlta {
  cuenta: string
  nombre: string
  codigoProveedor: string
  marca: string
  sufijoMarca: string
  categoriaId: string | null
  unidad: string
  ivaPorcentaje: number
  costo: number
  precios: PrecioElegido[]
  confirmar: boolean
}

const MSG_CONFIRMAR = "Confirme la operación antes de crear el producto en Alegra."

const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "")
const numero = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN)

function preciosDe(v: unknown): PrecioElegido[] | null {
  if (!Array.isArray(v)) return null
  const salida: PrecioElegido[] = []
  for (const x of v) {
    const o = x as { id?: unknown; precio?: unknown }
    const id = texto(o?.id, 40)
    const precio = numero(o?.precio)
    if (!id) return null
    salida.push({ id, precio })
  }
  return salida
}

/** Referencia del producto: código del proveedor + "-" + sufijo de marca (en mayúsculas). */
export const construirReferencia = (codigoProveedor: string, sufijoMarca: string): string =>
  `${codigoProveedor.trim()}-${sufijoMarca.trim().toUpperCase()}`

export function validarEntradaAlta(body: unknown): EntradaAlta {
  const b = (body ?? {}) as Record<string, unknown>
  const falla = (m: string) => new ErrorCompras("validacion", m)
  const cuenta = texto(b.cuenta, 60)
  const nombre = texto(b.nombre, 150)
  const codigoProveedor = texto(b.codigoProveedor, 60)
  const marca = texto(b.marca, 80)
  const sufijoMarca = texto(b.sufijoMarca, 12).toUpperCase()
  const unidad = texto(b.unidad, 20) || "unit"
  const iva = numero(b.ivaPorcentaje)
  const costo = numero(b.costo)
  const precios = preciosDe(b.precios)
  if (!cuenta) throw falla("Indique la cuenta.")
  if (!nombre) throw falla("Indique el nombre del producto.")
  if (!codigoProveedor) throw falla("Indique el código del proveedor.")
  if (/\s/.test(codigoProveedor)) throw falla("El código del proveedor no puede contener espacios.")
  if (!marca) throw falla("Indique la marca.")
  if (!/^[A-Z0-9]{1,12}$/.test(sufijoMarca)) throw falla("Indique el sufijo de la marca (letras y números, hasta 12 caracteres).")
  if (!/^[A-Za-z0-9._-]+$/.test(unidad)) throw falla("La unidad de medida no es válida.")
  if (!Number.isFinite(iva) || iva < 0 || iva > 100) throw falla("El IVA debe estar entre 0 y 100.")
  if (!Number.isFinite(costo) || costo <= 0) throw falla("Indique un costo mayor a cero.")
  if (!precios) throw falla("Indique el precio de cada lista.")
  return {
    cuenta,
    nombre,
    codigoProveedor,
    marca,
    sufijoMarca,
    categoriaId: texto(b.categoriaId, 40) || null,
    unidad,
    ivaPorcentaje: iva,
    costo: Math.round(costo * 100) / 100,
    precios,
    confirmar: b.confirmar === true,
  }
}

// ── Dependencias (inyectables para los tests) ────────────────────────────────────────────────────

export interface AjusteLista {
  listaId: string
  porcentaje: number
}

export interface DepsAlta {
  listasDeCuenta: (config: TenantConfig) => Promise<AlegraPriceList[]>
  impuestos: (config: TenantConfig) => Promise<AlegraTax[]>
  buscarPorCodigo: (config: TenantConfig, codigo: string) => Promise<AlegraProduct[]>
  crearItem: (config: TenantConfig, input: AlegraItemCompraInput) => Promise<AlegraProduct>
  /** Productos del catálogo cuyo código (normalizado) coincide con alguno de los dados. */
  catalogoPorCodigos: (tenantId: string, codigos: string[]) => Promise<{ alegraId: string; code: string | null; name: string }[]>
  conLock: <T>(clave: string, fn: () => Promise<T>) => Promise<T>
  /** Deja el ítem recién creado en el espejo del CRM; devuelve el id de catálogo para la línea. */
  registrarEnEspejo: (tenantId: string, cuenta: CuentaDestino, config: TenantConfig, itemIdCuenta: string) => Promise<{ alegraId: string; espejado: boolean }>
  /** Guarda el % de las listas que no usan el por defecto. Devuelve cuántos guardó (null = no hay dónde). */
  guardarAjustes: (tenantId: string, cuentaId: string, itemIdCuenta: string, ajustes: AjusteLista[]) => Promise<number | null>
}

async function conLockAdvisory<T>(clave: string, fn: () => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${clave}))`)
    return fn()
  })
}

async function registrarEnEspejoReal(
  tenantId: string,
  cuenta: CuentaDestino,
  config: TenantConfig,
  itemIdCuenta: string,
): Promise<{ alegraId: string; espejado: boolean }> {
  const idCola = cuenta.principal ? itemIdCuenta : `${cuenta.slug}:${itemIdCuenta}`
  // Respaldo: si la lectura inmediata falla, la cola de refresco lo trae en minutos.
  await encolar(getDb(), tenantId, [idCola], "new-item")
  try {
    const leidoAt = new Date()
    if (cuenta.principal) {
      const item = await getItemParaEspejo(config, itemIdCuenta)
      if (!item) return { alegraId: idCola, espejado: false }
      await upsertProductos(tenantId, [item], { leidoAt, leidoPor: "webhook" })
      await escribirStockPrincipal(tenantId, getDb(), { alegraIds: [itemIdCuenta], origen: "webhook" })
      return { alegraId: idCola, espejado: true }
    }
    const base = getTenantById(tenantId)
    if (!base) return { alegraId: idCola, espejado: false }
    const r = await refrescarItemDeCuenta(base, idCola, leidoAt)
    return { alegraId: idCola, espejado: r !== "ignorado" && r !== "baja" }
  } catch (err) {
    console.warn(`[compras/alta] espejo diferido tenant=${tenantId}: ${err instanceof Error ? err.name : "error"}`)
    return { alegraId: idCola, espejado: false }
  }
}

export const DEPS_ALTA_REALES: DepsAlta = {
  listasDeCuenta: listPriceLists,
  impuestos: listTaxes,
  buscarPorCodigo: buscarItemsPorCodigo,
  crearItem: crearItemCompra,
  catalogoPorCodigos: async (tenantId, codigos) => {
    const buscados = new Set(codigos.map(normalizarCodigo).filter(Boolean))
    if (buscados.size === 0) return []
    const filas = await getDb()
      .select({ alegraId: catalogProducts.alegraId, code: catalogProducts.code, name: catalogProducts.name })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.tenantId, tenantId), sql`lower(btrim(${catalogProducts.code})) in (${sql.join([...buscados].map((c) => sql`${c}`), sql`, `)})`))
    return filas
  },
  conLock: conLockAdvisory,
  registrarEnEspejo: registrarEnEspejoReal,
  // El modelo de ajustes por producto y lista de Alegra todavía no existe (hace falta una
  // migración, pendiente de aprobación): no se persiste nada y la respuesta lo informa.
  guardarAjustes: async () => null,
}

// ── Vista previa de listas ───────────────────────────────────────────────────────────────────────

export async function listasParaAlta(
  config: TenantConfig,
  cuenta: Pick<CuentaDestino, "nombre">,
  costo: number,
  deps: Pick<DepsAlta, "listasDeCuenta"> = DEPS_ALTA_REALES,
): Promise<ListaConPrecio[]> {
  const r = listasConDefecto(await deps.listasDeCuenta(config), costo, cuenta.nombre)
  if (!r.ok) throw new ErrorCompras("listas_sin_coeficiente", r.error)
  return r.listas
}

// ── Resultado ────────────────────────────────────────────────────────────────────────────────────

export interface ResultadoAlta {
  /** Id de catálogo a usar en la línea de la compra. */
  alegraId: string
  itemIdCuenta: string
  referencia: string | null
  /** true si el ítem ya existía en la cuenta (no se creó nada). */
  yaExistia: boolean
  /** false = el espejo del CRM lo trae en unos minutos (el producto ya está en Alegra). */
  espejado: boolean
  /** Listas cuyo % no es el por defecto. */
  ajustes: AjusteLista[]
  /** Cuántos ajustes quedaron guardados; null = todavía no se persisten. */
  ajustesGuardados: number | null
}

const aAjustes = (listas: ListaConPrecio[]): AjusteLista[] =>
  listasConAjuste(listas).map((l) => ({ listaId: l.id, porcentaje: l.porcentaje }))

const inputItem = (
  e: { nombre: string; marca: string | null; categoriaId: string | null; unidad: string; costo: number },
  referencia: string,
  taxId: string | null,
  listas: ListaConPrecio[],
): AlegraItemCompraInput => ({
  name: e.nombre,
  reference: referencia,
  taxId,
  brand: e.marca,
  categoryId: e.categoriaId,
  unit: e.unidad,
  unitCost: e.costo,
  prices: listas.map((l) => ({ idPriceList: l.id, price: l.precio })),
})

// ── Crear producto ───────────────────────────────────────────────────────────────────────────────

export async function crearProductoCompra(
  tenantId: string,
  cuenta: CuentaDestino,
  config: TenantConfig,
  entrada: EntradaAlta,
  deps: DepsAlta = DEPS_ALTA_REALES,
): Promise<ResultadoAlta> {
  if (!entrada.confirmar) throw new ErrorCompras("confirmacion_requerida", MSG_CONFIRMAR)
  const referencia = construirReferencia(entrada.codigoProveedor, entrada.sufijoMarca)

  const [listasCuenta, impuestos] = await Promise.all([deps.listasDeCuenta(config), deps.impuestos(config)])
  const elegidas = aplicarPreciosElegidos(listasCuenta, entrada.costo, entrada.precios, cuenta.nombre)
  if (!elegidas.ok) throw new ErrorCompras("listas_sin_coeficiente", elegidas.error)
  const impuesto = elegirImpuestoParaLinea(impuestos, entrada.ivaPorcentaje)
  if (!impuesto && entrada.ivaPorcentaje > 0) {
    throw new ErrorCompras(
      "impuesto_sin_mapear",
      `No hay un impuesto activo con ${entrada.ivaPorcentaje} % de IVA en la cuenta de ${cuenta.nombre}.`,
    )
  }

  return deps.conLock(`compras-alta:${tenantId}:${cuenta.id}:${normalizarCodigo(referencia)}`, async () => {
    // El producto no puede existir en el catálogo (de ninguna cuenta): para eso es «Copiar».
    const enCatalogo = await deps.catalogoPorCodigos(tenantId, [referencia, entrada.codigoProveedor])
    if (enCatalogo.length > 0) {
      throw new ErrorCompras(
        "producto_existente",
        `Ya existe en el catálogo el producto "${enCatalogo[0].name}" con ese código. Búsquelo en la compra y, si falta en la cuenta de ${cuenta.nombre}, use «Copiar a ${cuenta.nombre}».`,
      )
    }
    // Idempotencia: ¿ya está en Alegra (doble clic, reintento tras un corte)?
    const existentes = (await deps.buscarPorCodigo(config, referencia)).filter((i) => normalizarCodigo(i.code) === normalizarCodigo(referencia))
    if (existentes.length > 1) {
      throw new ErrorCompras("producto_existente", `La referencia "${referencia}" está repetida en la cuenta de ${cuenta.nombre}. Corrija el duplicado en Alegra.`)
    }
    if (existentes.length === 1) {
      const it = existentes[0]
      if (it.status !== "active") {
        throw new ErrorCompras("item_inactivo", `La referencia "${referencia}" existe en ${cuenta.nombre} pero está inactiva. Reactívela en Alegra.`)
      }
      const espejo = await deps.registrarEnEspejo(tenantId, cuenta, config, it.alegraId)
      return { alegraId: espejo.alegraId, itemIdCuenta: it.alegraId, referencia, yaExistia: true, espejado: espejo.espejado, ajustes: [], ajustesGuardados: 0 }
    }

    const creado = await deps.crearItem(
      config,
      inputItem({ nombre: entrada.nombre, marca: entrada.marca, categoriaId: entrada.categoriaId, unidad: entrada.unidad, costo: entrada.costo }, referencia, impuesto?.alegraId ?? null, elegidas.listas),
    )
    const espejo = await deps.registrarEnEspejo(tenantId, cuenta, config, creado.alegraId)
    const ajustes = aAjustes(elegidas.listas)
    const ajustesGuardados = ajustes.length === 0 ? 0 : await deps.guardarAjustes(tenantId, cuenta.id, creado.alegraId, ajustes)
    return { alegraId: espejo.alegraId, itemIdCuenta: creado.alegraId, referencia, yaExistia: false, espejado: espejo.espejado, ajustes, ajustesGuardados }
  })
}

// ── Copiar a la cuenta ───────────────────────────────────────────────────────────────────────────

export interface EntradaCopia {
  cuenta: string
  alegraId: string
  precios: PrecioElegido[]
  confirmar: boolean
}

export function validarEntradaCopia(body: unknown): EntradaCopia {
  const b = (body ?? {}) as Record<string, unknown>
  const cuenta = texto(b.cuenta, 60)
  const alegraId = texto(b.alegraId, 80)
  const precios = preciosDe(b.precios)
  if (!cuenta || !alegraId) throw new ErrorCompras("validacion", "Indique la cuenta y el producto.")
  if (!precios) throw new ErrorCompras("validacion", "Indique el precio de cada lista.")
  return { cuenta, alegraId, precios, confirmar: b.confirmar === true }
}

export interface DatosCopia {
  code: string | null
  name: string
  brand: string | null
  ivaPorcentaje: number | null
  costo: number | null
}

export async function datosParaCopia(tenantId: string, alegraId: string): Promise<DatosCopia | null> {
  const [f] = await getDb()
    .select({ code: catalogProducts.code, name: catalogProducts.name, brand: catalogProducts.brand, iva: catalogProducts.ivaPorcentaje, costo: catalogProducts.costo })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.alegraId, alegraId)))
  if (!f) return null
  return { code: f.code, name: f.name, brand: f.brand, ivaPorcentaje: f.iva === null ? null : Number(f.iva), costo: f.costo === null ? null : Number(f.costo) }
}

export async function copiarProductoACuenta(
  tenantId: string,
  cuenta: CuentaDestino,
  config: TenantConfig,
  entrada: EntradaCopia,
  deps: DepsAlta & { datos?: (tenantId: string, alegraId: string) => Promise<DatosCopia | null>; asegurar?: typeof asegurarItemsEnCuenta } = DEPS_ALTA_REALES,
): Promise<ResultadoAlta> {
  if (!entrada.confirmar) throw new ErrorCompras("confirmacion_requerida", MSG_CONFIRMAR)
  const datos = await (deps.datos ?? datosParaCopia)(tenantId, entrada.alegraId)
  if (!datos) throw new ErrorCompras("producto_inexistente", "El producto ya no está en el catálogo.")
  if (!datos.code?.trim()) throw new ErrorCompras("sin_codigo", `El producto "${datos.name}" no tiene código: no se puede copiar a ${cuenta.nombre}.`)
  if (datos.costo === null || datos.costo <= 0) {
    throw new ErrorCompras("sin_costo", `El producto "${datos.name}" no tiene costo en el catálogo: no se pueden calcular sus listas de precio.`)
  }
  const costo = datos.costo
  const iva = datos.ivaPorcentaje ?? 21
  const listasCuenta = await deps.listasDeCuenta(config)
  const elegidas = aplicarPreciosElegidos(listasCuenta, costo, entrada.precios, cuenta.nombre)
  if (!elegidas.ok) throw new ErrorCompras("listas_sin_coeficiente", elegidas.error)

  // Misma regla de copia de la facturación; el alta usa el payload completo (costo, listas, venta sin stock).
  const depsCopia: DepsItemsCuenta = {
    buscarPorCodigo: deps.buscarPorCodigo,
    listTaxes: deps.impuestos,
    crearItem: (c, input) =>
      deps.crearItem(
        c,
        inputItem({ nombre: input.name, marca: input.brand ?? null, categoriaId: null, unidad: "unit", costo }, input.code ?? datos.code!, input.taxId, elegidas.listas),
      ),
  }
  const asegurar = deps.asegurar ?? asegurarItemsEnCuenta
  const r = await asegurar(
    tenantId,
    config,
    cuenta,
    [{ alegraItemId: entrada.alegraId, nombre: datos.name, precioUnitario: elegidas.listas[0].precio, ivaPorcentaje: iva }],
    depsCopia,
  )
  if (!r.ok) throw new ErrorCompras("copia_rechazada", r.error)
  const itemIdCuenta = r.ids.get(entrada.alegraId)!
  const creado = r.creados.includes(entrada.alegraId)
  let espejado = true
  if (creado) espejado = (await deps.registrarEnEspejo(tenantId, cuenta, config, itemIdCuenta)).espejado
  const ajustes = creado ? aAjustes(elegidas.listas) : []
  const ajustesGuardados = ajustes.length === 0 ? 0 : await deps.guardarAjustes(tenantId, cuenta.id, itemIdCuenta, ajustes)
  return { alegraId: entrada.alegraId, itemIdCuenta, referencia: datos.code, yaExistia: !creado, espejado, ajustes, ajustesGuardados }
}
