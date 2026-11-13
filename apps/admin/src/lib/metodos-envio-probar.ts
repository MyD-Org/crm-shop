/**
 * "Prueba de dirección" del editor de zonas: usa EXACTAMENTE las funciones que decidirán en el Shop
 * (`resolverZona`/`cotizarMetodo`, `estimarPorLocalidad`, `fechaEntrega`). Puro salvo la función de
 * respaldo para completar una localidad, que se inyecta. Textos en usted / neutro.
 */
import { cotizarMetodo, estimarPorLocalidad, type DestinoEnvio, type EstimadoLocalidad, type MetodoEnvio } from "@/lib/envio-zona"
import { fechaEntrega, type FechaEntrega } from "@/lib/entrega-fecha"
import type { GeoLocalidad } from "@/lib/metodos-envio-localidades"
import type { MetodoEnvioValidado } from "@/lib/metodos-envio-validacion"
import { claveTexto } from "@/lib/texto-clave"

/** Método puro más los feriados que el CRM guarda en `config.feriados` (el módulo puro duplicado no los declara). */
export type MetodoEnvioConFeriados = MetodoEnvio & { feriados?: string[] }

export const MENSAJE_SIN_ZONA = "Sin zona: costo a coordinar."

export type ResultadoPruebaDireccion =
  | {
      aplica: true
      zonaId: string
      zona: string
      regla: "poligono" | "cp" | "georef"
      precio: number
      precision: "altura" | "calle" | null
      promesa: string
      avisoFeriados: string
      /** Si el pago se confirmara en este momento. */
      entrega: FechaEntrega
      mensaje: string
    }
  | { aplica: false; mensaje: string }

export type ResultadoPruebaLocalidad =
  | { aplica: true; estimado: EstimadoLocalidad; mensaje: string }
  | { aplica: false; mensaje: string }

const pesos = (n: number) => `$${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`

export function probarDireccion(m: MetodoEnvioConFeriados, d: Omit<DestinoEnvio, "provinciaClave"> & { provinciaClave?: string | null }, ahora: Date): ResultadoPruebaDireccion {
  // La prueba ignora si el método está activo y de qué sucursal sale: sólo evalúa la zona y el precio.
  const r = cotizarMetodo(
    { ...m, activo: true, sucursalOrigen: null },
    { ...d, provinciaClave: d.provinciaClave ?? m.provinciaClave },
    { origen: null, subtotalSinIva: 0, gratisTienda: false, gratisCupon: false },
  )
  if (!r) return { aplica: false, mensaje: MENSAJE_SIN_ZONA }
  const entrega = fechaEntrega(ahora, { ...r.horario, feriados: m.feriados })
  const aprox = r.precision === "calle" ? " La ubicación es aproximada (se resolvió sólo hasta la calle)." : ""
  return {
    aplica: true,
    zonaId: r.zonaId,
    zona: r.zona,
    regla: r.regla,
    precio: r.precio,
    precision: r.precision,
    promesa: r.promesa,
    avisoFeriados: r.avisoFeriados,
    entrega,
    mensaje: `Zona «${r.zona}» a ${pesos(r.precio)}.${aprox}`,
  }
}

export async function probarLocalidad(
  m: MetodoEnvio,
  georefId: string,
  completar?: (georefId: string) => Promise<GeoLocalidad>,
): Promise<ResultadoPruebaLocalidad> {
  const cargada = m.localidades?.find((l) => l.georefId === georefId)
  let loc = cargada ?? { georefId }
  if (!cargada && completar) loc = { georefId, ...(await completar(georefId)) }
  const e = estimarPorLocalidad({ ...m, activo: true }, loc)
  if (!e) return { aplica: false, mensaje: MENSAJE_SIN_ZONA }
  const texto =
    e.tipo === "exacto"
      ? `Toda la localidad cae en la zona «${e.zona}»: ${pesos(e.precio)}.`
      : `El precio depende de la dirección exacta: desde ${pesos(e.precio)}.`
  return { aplica: true, estimado: e, mensaje: texto }
}

/** "Mar del Plata (General Pueyrredón) — Buenos Aires" → clave de "Mar del Plata". */
function nombreNormDeEtiqueta(etiqueta: string): string {
  return claveTexto(etiqueta.split("—")[0].replace(/\([^)]*\)/g, ""))
}

/** Un método todavía sin guardar (validado) en la forma de los módulos puros, para probarlo en vivo. */
export function metodoDeBorrador(v: MetodoEnvioValidado): MetodoEnvioConFeriados {
  return {
    feriados: v.feriados,
    id: "borrador",
    slug: v.slug,
    nombre: v.nombre,
    tipo: "tarifa_zona",
    activo: true,
    orden: v.orden,
    provinciaClave: v.provinciaClave,
    sucursalOrigen: v.sucursalOrigen,
    diasOperativos: v.diasOperativos,
    horaCorte: v.horaCorte,
    margenMin: v.margenMin,
    promesa: v.promesa,
    avisoFeriados: v.avisoFeriados,
    gratisAplica: v.gratisAplica,
    itemAlegraId: v.itemAlegraId,
    itemAlegraIva: v.itemAlegraIva,
    zonas: v.zonas.map((z, i) => ({
      id: z.id ?? `borrador-${i}`,
      nombre: z.nombre,
      precio: z.precio,
      orden: z.orden,
      activa: z.activa,
      geometria: z.geometria,
      entradas: z.entradas.map((e) => ({ ...e, nombreNorm: e.tipo === "georef" ? nombreNormDeEtiqueta(e.etiqueta) : claveTexto(e.valor) })),
    })),
    localidades: v.localidades.map((l) => ({ georefId: l.georefId, etiqueta: l.etiqueta, nombreNorm: nombreNormDeEtiqueta(l.etiqueta), abreviaturas: l.abreviaturas })),
  }
}
