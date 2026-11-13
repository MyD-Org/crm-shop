// Estado del formulario del editor de métodos de envío y sus conversiones (change
// `envio-por-zona-con-tarifa`, rebanada A). Puro: el editor sólo pinta y delega acá lo que se prueba.
import type { Geometria } from "@/lib/geo-poligono"
import type { MetodoEnvioDto } from "@/lib/metodos-envio-repo"

export interface FormEntrada {
  tipo: "georef" | "cp"
  valor: string
  etiqueta: string
}

export interface FormZona {
  /** Clave local, estable mientras se edita (la zona nueva todavía no tiene id). */
  clave: string
  id?: string
  nombre: string
  precio: string
  orden: string
  activa: boolean
  geometria: Geometria
  entradas: FormEntrada[]
}

export interface FormLocalidad {
  georefId: string
  etiqueta: string
  /** Separadas por coma. */
  abreviaturas: string
}

export interface FormMetodo {
  id?: string
  slug: string
  nombre: string
  activo: boolean
  provincia: string
  /** "" = sin condición de origen. */
  sucursalOrigen: string
  dias: number[]
  horaCorte: string
  margenMin: string
  promesa: string
  avisoFeriados: string
  horarioEntrega: string
  gratisAplica: boolean
  itemAlegraId: string
  itemAlegraIva: string
  zonas: FormZona[]
  localidades: FormLocalidad[]
}

let contador = 0
const claveNueva = () => `z${Date.now().toString(36)}${(contador++).toString(36)}`

export function zonaVacia(existentes: FormZona[]): FormZona {
  return {
    clave: claveNueva(),
    nombre: `Zona ${existentes.length + 1}`,
    precio: "",
    orden: String(existentes.length + 1),
    activa: true,
    geometria: [],
    entradas: [],
  }
}

export function formVacio(): FormMetodo {
  return {
    slug: "",
    nombre: "Envío en el día",
    activo: false,
    provincia: "Buenos Aires",
    sucursalOrigen: "",
    dias: [1, 2, 3, 4, 5],
    horaCorte: "09:00",
    margenMin: "0",
    promesa: "",
    avisoFeriados: "",
    horarioEntrega: "",
    gratisAplica: false,
    itemAlegraId: "",
    itemAlegraIva: "21",
    zonas: [],
    localidades: [],
  }
}

export function dtoAForm(m: MetodoEnvioDto): FormMetodo {
  return {
    id: m.id,
    slug: m.slug,
    nombre: m.nombre,
    activo: m.activo,
    provincia: m.provincia,
    sucursalOrigen: m.sucursalOrigen ?? "",
    dias: m.diasOperativos,
    horaCorte: m.horaCorte,
    margenMin: String(m.margenMin),
    promesa: m.promesa,
    avisoFeriados: m.avisoFeriados,
    horarioEntrega: m.horarioEntrega,
    gratisAplica: m.gratisAplica,
    itemAlegraId: m.itemAlegraId ?? "",
    itemAlegraIva: String(m.itemAlegraIva),
    zonas: m.zonas.map((z) => ({
      clave: z.id,
      id: z.id,
      nombre: z.nombre,
      precio: String(z.precio),
      orden: String(z.orden),
      activa: z.activa,
      geometria: z.geometria,
      entradas: z.entradas.map((e) => ({ ...e })),
    })),
    localidades: m.localidades.map((l) => ({ georefId: l.georefId, etiqueta: l.etiqueta, abreviaturas: l.abreviaturas.join(", ") })),
  }
}

/** Número de un campo de texto; vacío = 0, no numérico = NaN (viaja como null y el servidor lo rechaza). */
const numero = (t: string, vacio: number) => (t.trim() === "" ? vacio : Number(t.replace(",", ".")))

export function formACuerpo(f: FormMetodo) {
  return {
    slug: f.slug,
    nombre: f.nombre,
    activo: f.activo,
    provincia: f.provincia,
    sucursalOrigen: f.sucursalOrigen || null,
    diasOperativos: f.dias,
    horaCorte: f.horaCorte,
    margenMin: numero(f.margenMin, 0),
    promesa: f.promesa,
    avisoFeriados: f.avisoFeriados,
    horarioEntrega: f.horarioEntrega,
    gratisAplica: f.gratisAplica,
    itemAlegraId: f.itemAlegraId,
    itemAlegraIva: numero(f.itemAlegraIva, 21),
    zonas: f.zonas.map((z, i) => ({
      ...(z.id && { id: z.id }),
      nombre: z.nombre,
      precio: z.precio,
      orden: numero(z.orden, i + 1),
      activa: z.activa,
      geometria: z.geometria,
      entradas: z.entradas,
    })),
    localidades: f.localidades.map((l) => ({
      georefId: l.georefId,
      etiqueta: l.etiqueta,
      abreviaturas: l.abreviaturas.split(",").map((a) => a.trim()).filter(Boolean),
    })),
  }
}

const NOMBRES_DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes"]
const pesos = (n: number) => `$${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`

/** Cómo funciona el método, en lenguaje simple, para la lista. */
export function resumenMetodo(m: MetodoEnvioDto): string[] {
  const dias =
    m.diasOperativos.length === 5
      ? "de lunes a viernes"
      : m.diasOperativos.map((d) => NOMBRES_DIAS[d - 1]).join(", ")
  const lineas = [
    `En ${m.provincia}, ${dias}. Los pedidos confirmados antes de las ${m.horaCorte}${m.margenMin > 0 ? ` (menos ${m.margenMin} minutos de margen)` : ""} se entregan el mismo día; después, el siguiente día hábil.`,
  ]
  if (m.sucursalOrigen) lineas.push(`Sólo si todos los productos salen de la sucursal «${m.sucursalOrigen}».`)
  if (m.zonas.length === 0) lineas.push("Todavía no tiene zonas.")
  for (const z of m.zonas) {
    const partes = [`${z.nombre}: ${pesos(z.precio)}`]
    if (z.geometria.length === 0) partes.push("sin dibujo en el mapa")
    if (z.entradas.length > 0) partes.push(`${z.entradas.length} ${z.entradas.length === 1 ? "localidad o código postal" : "localidades o códigos postales"} de respaldo`)
    if (!z.activa) partes.push("inactiva")
    lineas.push(partes.join(" · "))
  }
  lineas.push(m.gratisAplica ? "El envío gratis de la tienda y los cupones de envío gratis aplican a este método." : "El envío gratis no anula esta tarifa.")
  return lineas
}
