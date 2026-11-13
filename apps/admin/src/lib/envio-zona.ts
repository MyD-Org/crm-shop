/**
 * Resolución de zona y cotización del método "Envío en el día" (change `envio-por-zona-con-tarifa`).
 * Módulo PURO: sin DB, reloj ni Next. Recibe el método como DATOS y devuelve la zona y el precio.
 *
 * Copia en el CRM de `apps/clientes/src/lib/envio-zona.ts` (no hay paquetes compartidos); las dos
 * ejecutan el MISMO fixture (`__fixtures__/envio-zona-casos.json`). El CRM la usa para la "Prueba de
 * dirección" con exactamente la misma función que decide en el Shop. Si cambia una, cambia la otra.
 *
 * Prioridad de la regla (gana la de mayor rango): `poligono` (4: punto verificado dentro de la
 * geometría de una zona activa) > `cp` (2) > `georef` (1: id Georef o nombre normalizado de la
 * localidad en la provincia del método). Entre zonas con la misma regla gana la de menor `orden`.
 */
import { claveTexto } from "./texto-clave"
import {
  bboxContenidoEn,
  geometriaInterseca,
  puntoEnGeometria,
  type Bbox,
  type Geometria,
} from "./geo-poligono"

export type ReglaZona = "poligono" | "cp" | "georef"
export type PrecisionPunto = "altura" | "calle"

export interface EntradaZona {
  tipo: "georef" | "cp"
  valor: string
  etiqueta?: string
  /** claveTexto del nombre de la localidad (sólo entradas georef). */
  nombreNorm?: string
}

export interface ZonaEnvio {
  id: string
  nombre: string
  /** Precio FINAL con IVA incluido. */
  precio: number
  orden: number
  activa: boolean
  geometria: Geometria
  entradas: EntradaZona[]
}

export interface LocalidadAtendida {
  georefId: string
  etiqueta?: string
  nombreNorm?: string
  abreviaturas?: string[]
  centro?: { lat: number; lon: number } | null
  bbox?: Bbox | null
}

export interface MetodoEnvio {
  id: string
  slug: string
  nombre: string
  tipo: "tarifa_zona"
  activo: boolean
  orden: number
  provinciaClave: string
  sucursalOrigen: string | null
  diasOperativos: number[]
  horaCorte: string
  margenMin: number
  promesa: string
  avisoFeriados: string
  gratisAplica: boolean
  itemAlegraId: string | null
  itemAlegraIva: number
  zonas: ZonaEnvio[]
  localidades?: LocalidadAtendida[]
}

export interface DestinoEnvio {
  provinciaClave: string | null
  localidad?: string | null
  georefId?: string | null
  cp?: string | null
  /** Coordenadas YA verificadas por el servidor (nunca las crudas del navegador). */
  punto?: { lat: number; lon: number; precision: PrecisionPunto } | null
}

export interface ZonaResuelta {
  zona: ZonaEnvio
  regla: ReglaZona
}

const porOrden = (a: ZonaEnvio, b: ZonaEnvio) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)
const activas = (m: MetodoEnvio) => m.zonas.filter((z) => z.activa).sort(porOrden)

/** Quita espacios y guiones y pasa a mayúsculas: "b 7600-abc" → "B7600ABC". */
function normalizarCp(cp: string): string {
  return cp.replace(/[\s-]/g, "").toUpperCase()
}

/** Los 4 dígitos de un CP argentino ("7600" o CPA "B7600ABC"); null si no tiene esa forma. */
function digitosCp(cp: string): string | null {
  const n = normalizarCp(cp)
  if (/^\d{4}$/.test(n)) return n
  const m = /^[A-Z](\d{4})[A-Z]{3}$/.exec(n)
  return m ? m[1] : null
}

function coincideCp(entrada: string, cp: string): boolean {
  const e = normalizarCp(entrada)
  const c = normalizarCp(cp)
  if (e === c) return true
  const de = digitosCp(e)
  const dc = digitosCp(c)
  // Una entrada de 4 dígitos cubre cualquier CPA con esos dígitos; una CPA sólo a esa misma.
  return de !== null && dc !== null && e.length === 4 && de === dc
}

export function resolverZona(m: MetodoEnvio, d: DestinoEnvio): ZonaResuelta | null {
  if (!d.provinciaClave || d.provinciaClave !== m.provinciaClave) return null
  const zonas = activas(m)

  if (d.punto) {
    const { lat, lon } = d.punto
    const z = zonas.find((zona) => zona.geometria.length > 0 && puntoEnGeometria(lat, lon, zona.geometria))
    if (z) return { zona: z, regla: "poligono" }
  }

  if (d.cp) {
    const cp = d.cp
    const z = zonas.find((zona) => zona.entradas.some((e) => e.tipo === "cp" && coincideCp(e.valor, cp)))
    if (z) return { zona: z, regla: "cp" }
  }

  const nombre = d.localidad ? claveTexto(d.localidad) : ""
  if (d.georefId || nombre) {
    const z = zonas.find((zona) =>
      zona.entradas.some(
        (e) => e.tipo === "georef" && ((d.georefId && e.valor === d.georefId) || (nombre && e.nombreNorm === nombre)),
      ),
    )
    if (z) return { zona: z, regla: "georef" }
  }
  return null
}

export interface EstimadoLocalidad {
  tipo: "exacto" | "desde"
  precio: number
  zona?: string
}

/**
 * Precio que se puede anticipar sabiendo sólo la LOCALIDAD (ficha y carrito, antes de tener la
 * dirección). `exacto` si toda la localidad cae en una sola zona; `desde` (el mínimo de las zonas
 * que podrían aplicar) si no; null si ninguna zona la alcanza (se muestran los textos actuales).
 * Recorre las zonas por `orden`: una zona que contiene el rectángulo entero de la localidad tapa a
 * las siguientes. Sin rectángulo (`bbox`) nunca devuelve `exacto` por polígono.
 */
export function estimarPorLocalidad(m: MetodoEnvio, loc: LocalidadAtendida): EstimadoLocalidad | null {
  const zonas = activas(m)
  const zonaEntrada = zonas.find((z) => z.entradas.some((e) => e.tipo === "georef" && e.valor === loc.georefId)) ?? null
  const area: Bbox | null = loc.bbox
    ? loc.bbox
    : loc.centro
      ? { sur: loc.centro.lat, norte: loc.centro.lat, oeste: loc.centro.lon, este: loc.centro.lon }
      : null

  if (!area) {
    // Sin ubicación de la localidad no se sabe qué polígonos toca: lo más bajo que podría aplicar.
    if (!zonaEntrada) return null
    const candidatas = [zonaEntrada, ...zonas.filter((z) => z !== zonaEntrada && z.geometria.length > 0)]
    if (candidatas.length === 1) return { tipo: "exacto", precio: zonaEntrada.precio, zona: zonaEntrada.nombre }
    return { tipo: "desde", precio: Math.min(...candidatas.map((z) => z.precio)) }
  }

  const conjunto: ZonaEnvio[] = []
  let tapada = false
  for (const z of zonas) {
    if (z.geometria.length === 0 || !geometriaInterseca(z.geometria, area)) continue
    conjunto.push(z)
    if (loc.bbox && bboxContenidoEn(loc.bbox, z.geometria)) {
      tapada = true
      break
    }
  }
  if (!tapada && zonaEntrada && !conjunto.includes(zonaEntrada)) conjunto.push(zonaEntrada)

  if (conjunto.length === 0) return null
  const soloEntrada = zonaEntrada !== null && conjunto.length === 1 && conjunto[0] === zonaEntrada
  if (conjunto.length === 1 && (tapada || soloEntrada)) {
    return { tipo: "exacto", precio: conjunto[0].precio, zona: conjunto[0].nombre }
  }
  return { tipo: "desde", precio: Math.min(...conjunto.map((z) => z.precio)) }
}

export interface ContextoCotizacion {
  /**
   * Sucursal que despacha y si hay líneas a traer. `null` = no se conoce (flag de disponibilidad por
   * sucursal apagado): la condición de origen se ignora.
   */
  origen: { sucursal: string | null; conTraslado: boolean } | null
  subtotalSinIva: number
  /** La regla de envío gratis de la tienda está cumplida. */
  gratisTienda: boolean
  /** Hay un cupón de envío gratis aplicable. */
  gratisCupon: boolean
}

export interface ResultadoMetodo {
  metodoId: string
  slug: string
  nombre: string
  zonaId: string
  zona: string
  /** Tarifa de la zona (con IVA), aunque el envío salga gratis. */
  precio: number
  /** Lo que se cobra: 0 si es gratis. */
  costo: number
  gratis: boolean
  regla: ReglaZona
  precision: PrecisionPunto | null
  promesa: string
  avisoFeriados: string
  alegra: { itemId: string | null; ivaPct: number }
  horario: { dias: number[]; horaCorte: string; margenMin: number }
}

/** null = el método no aplica (inactivo, otro origen, sin zona): el envío queda "a coordinar". */
export function cotizarMetodo(m: MetodoEnvio, d: DestinoEnvio, ctx: ContextoCotizacion): ResultadoMetodo | null {
  if (!m.activo) return null
  if (m.sucursalOrigen && ctx.origen && (ctx.origen.sucursal !== m.sucursalOrigen || ctx.origen.conTraslado)) {
    return null
  }
  const r = resolverZona(m, d)
  if (!r) return null
  // Con `gratisAplica` apagado ni la regla de la tienda ni un cupón de envío gratis anulan la tarifa.
  const gratis = m.gratisAplica && (ctx.gratisTienda || ctx.gratisCupon)
  return {
    metodoId: m.id,
    slug: m.slug,
    nombre: m.nombre,
    zonaId: r.zona.id,
    zona: r.zona.nombre,
    precio: r.zona.precio,
    costo: gratis ? 0 : r.zona.precio,
    gratis,
    regla: r.regla,
    precision: d.punto?.precision ?? null,
    promesa: m.promesa,
    avisoFeriados: m.avisoFeriados,
    alegra: { itemId: m.itemAlegraId, ivaPct: m.itemAlegraIva },
    horario: { dias: m.diasOperativos, horaCorte: m.horaCorte, margenMin: m.margenMin },
  }
}
