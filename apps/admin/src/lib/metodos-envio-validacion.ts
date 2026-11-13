// Validación pura de un método de envío por zona (change `envio-por-zona-con-tarifa`, rebanada A):
// la usa la API del admin antes de guardar y el formulario muestra el mismo mensaje. Sin DB ni Next.
// Textos en usted. Devuelve el método normalizado (lo que se persiste) y avisos que NO impiden
// guardar (solapes de polígonos).

import { claveProvinciaZona } from "@/lib/sucursales-zona"
import { claveTexto } from "@/lib/texto-clave"
import { MAX_FERIADOS, MAX_HORARIO_ENTREGA, normalizarFeriados, normalizarHorarioEntrega } from "@/lib/metodos-envio-horario"
import { bboxDe, bboxInterseca, puntoEnGeometria, validarGeometria, type Geometria } from "@/lib/geo-poligono"

export interface EntradaValidada {
  tipo: "georef" | "cp"
  valor: string
  etiqueta: string
}

export interface ZonaValidada {
  /** Id de una zona ya guardada (se conserva al guardar); sin id, la zona es nueva. */
  id?: string
  nombre: string
  /** Precio FINAL con IVA incluido. */
  precio: number
  orden: number
  activa: boolean
  geometria: Geometria
  entradas: EntradaValidada[]
}

export interface LocalidadValidada {
  georefId: string
  etiqueta: string
  abreviaturas: string[]
}

export interface MetodoEnvioValidado {
  slug: string
  nombre: string
  activo: boolean
  orden: number
  provinciaClave: string
  /** Nombre canónico tal como lo tipeó el operador (se muestra en el editor). */
  provincia: string
  sucursalOrigen: string | null
  diasOperativos: number[]
  horaCorte: string
  margenMin: number
  promesa: string
  avisoFeriados: string
  /** Texto libre corto (hasta 40) que se guarda en `config.horarioEntrega`; "" = sin horario. */
  horarioEntrega: string
  /** Fechas "YYYY-MM-DD" sin entrega (hasta 60, ordenadas y sin repetir); se guardan en `config.feriados`. */
  feriados: string[]
  gratisAplica: boolean
  itemAlegraId: string | null
  itemAlegraIva: number
  zonas: ZonaValidada[]
  localidades: LocalidadValidada[]
}

export type ResultadoValidacionMetodo =
  | { ok: true; metodo: MetodoEnvioValidado; avisos: string[] }
  | { ok: false; campo: string; error: string }

const MAX_PRECIO = 100_000_000
const MAX_ZONAS = 50
const MAX_LOCALIDADES = 50
const MAX_ENTRADAS_POR_ZONA = 200

const falla = (campo: string, error: string): ResultadoValidacionMetodo => ({ ok: false, campo, error })
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const texto = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim().length <= max ? v.trim() : null)

function parsearPrecio(v: unknown): number | null {
  let n: number
  if (typeof v === "number") n = v
  else if (typeof v === "string" && /^\s*\d+([.,]\d{1,2})?\s*$/.test(v)) n = Number(v.trim().replace(",", "."))
  else return null
  if (!Number.isFinite(n) || n <= 0 || n >= MAX_PRECIO) return null
  return Math.round(n * 100) / 100
}

function slugDe(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

function normalizarCp(valor: string): string {
  return valor.replace(/[\s-]/g, "").toUpperCase()
}

// ── Solapes (aviso) ─────────────────────────────────────────────────────────────────────────

function sobreBorde(lat: number, lon: number, g: Geometria): boolean {
  for (const poligono of g) {
    for (const anillo of poligono) {
      for (let i = 0; i < anillo.length - 1; i++) {
        const [ax, ay] = anillo[i]
        const [bx, by] = anillo[i + 1]
        if (Math.abs((bx - ax) * (lat - ay) - (by - ay) * (lon - ax)) > 1e-12) continue
        if (lon >= Math.min(ax, bx) - 1e-12 && lon <= Math.max(ax, bx) + 1e-12 && lat >= Math.min(ay, by) - 1e-12 && lat <= Math.max(ay, by) + 1e-12) return true
      }
    }
  }
  return false
}

function interiorEn(lat: number, lon: number, g: Geometria): boolean {
  return puntoEnGeometria(lat, lon, g) && !sobreBorde(lat, lon, g)
}

function aristasCruzan(a: Geometria, b: Geometria): boolean {
  const lados = (g: Geometria) => g.flatMap((p) => p.flatMap((r) => r.slice(0, -1).map((pt, i) => [pt, r[i + 1]] as const)))
  const cr = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  const eps = 1e-12
  for (const [p1, p2] of lados(a)) {
    for (const [p3, p4] of lados(b)) {
      const o1 = cr(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1])
      const o2 = cr(p1[0], p1[1], p2[0], p2[1], p4[0], p4[1])
      const o3 = cr(p3[0], p3[1], p4[0], p4[1], p1[0], p1[1])
      const o4 = cr(p3[0], p3[1], p4[0], p4[1], p2[0], p2[1])
      if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) return true
    }
  }
  return false
}

/** ¿Se pisan en una superficie (no sólo comparten un borde)? */
function seSolapan(a: Geometria, b: Geometria): boolean {
  if (a.length === 0 || b.length === 0) return false
  if (!bboxInterseca(bboxDe(a), bboxDe(b))) return false
  const puntosDe = (g: Geometria) => g.flatMap((p) => p.flatMap((r) => r.slice(0, -1)))
  const medios = (g: Geometria) =>
    g.flatMap((p) => p.flatMap((r) => r.slice(0, -1).map((pt, i) => [(pt[0] + r[i + 1][0]) / 2, (pt[1] + r[i + 1][1]) / 2] as const)))
  if (puntosDe(a).some(([lon, lat]) => interiorEn(lat, lon, b)) || puntosDe(b).some(([lon, lat]) => interiorEn(lat, lon, a))) return true
  if (medios(a).some(([lon, lat]) => interiorEn(lat, lon, b)) || medios(b).some(([lon, lat]) => interiorEn(lat, lon, a))) return true
  return aristasCruzan(a, b)
}

// ── Validación ──────────────────────────────────────────────────────────────────────────────

export function validarMetodoEnvio(body: unknown): ResultadoValidacionMetodo {
  if (!esObjeto(body)) return falla("body", "Los datos del método no son válidos.")

  const nombre = texto(body.nombre, 80)
  if (!nombre) return falla("nombre", "Ingrese el nombre del método (hasta 80 caracteres).")

  const slugCrudo = typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : slugDe(nombre)
  if (!/^[a-z0-9-]{1,40}$/.test(slugCrudo)) {
    return falla("slug", "El identificador sólo admite minúsculas, números y guiones (hasta 40 caracteres).")
  }

  const provincia = typeof body.provincia === "string" ? body.provincia.trim() : ""
  const provinciaClave = claveProvinciaZona(provincia)
  if (!provinciaClave) return falla("provincia", "Seleccione la provincia en la que aplica el método.")

  let sucursalOrigen: string | null = null
  if (body.sucursalOrigen !== undefined && body.sucursalOrigen !== null && body.sucursalOrigen !== "") {
    if (typeof body.sucursalOrigen !== "string" || !/^[a-z0-9-]{2,20}$/.test(body.sucursalOrigen)) {
      return falla("sucursalOrigen", "La sucursal de origen no es válida.")
    }
    sucursalOrigen = body.sucursalOrigen
  }

  const diasCrudos = Array.isArray(body.diasOperativos) ? body.diasOperativos : null
  if (!diasCrudos || diasCrudos.length === 0 || !diasCrudos.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) {
    return falla("diasOperativos", "Seleccione al menos un día de lunes a sábado.")
  }
  const diasOperativos = [...new Set(diasCrudos as number[])].sort((a, b) => a - b)

  const horaCorte = typeof body.horaCorte === "string" ? body.horaCorte.trim() : ""
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horaCorte)) return falla("horaCorte", "Ingrese la hora de corte con el formato HH:MM, por ejemplo 09:00.")

  const margenMin = body.margenMin === undefined ? 0 : body.margenMin
  if (typeof margenMin !== "number" || !Number.isInteger(margenMin) || margenMin < 0 || margenMin > 240) {
    return falla("margenMin", "Ingrese un margen en minutos entero, entre 0 y 240.")
  }

  const promesa = body.promesa === undefined ? "" : texto(body.promesa, 200)
  if (promesa === null) return falla("promesa", "El texto de la promesa admite hasta 200 caracteres.")
  const avisoFeriados = body.avisoFeriados === undefined ? "" : texto(body.avisoFeriados, 300)
  if (avisoFeriados === null) return falla("avisoFeriados", "El aviso de feriados admite hasta 300 caracteres.")
  const horarioEntrega = normalizarHorarioEntrega(body.horarioEntrega)
  if (horarioEntrega === null) return falla("horarioEntrega", `El horario de entrega admite hasta ${MAX_HORARIO_ENTREGA} caracteres.`)
  const feriados = normalizarFeriados(body.feriados)
  if (feriados === null) {
    return falla("feriados", `Ingrese hasta ${MAX_FERIADOS} feriados, cada uno con una fecha válida (AAAA-MM-DD).`)
  }

  const activo = body.activo === true
  const gratisAplica = body.gratisAplica === true

  let itemAlegraId: string | null = null
  if (typeof body.itemAlegraId === "string" && body.itemAlegraId.trim()) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(body.itemAlegraId.trim())) return falla("itemAlegraId", "El identificador del ítem de Alegra no es válido.")
    itemAlegraId = body.itemAlegraId.trim()
  }
  if (activo && !itemAlegraId) {
    return falla("itemAlegraId", "Para activar el método indique el ítem de Alegra del servicio de envío; sin él no se puede facturar.")
  }
  const iva = body.itemAlegraIva === undefined ? 21 : body.itemAlegraIva
  if (typeof iva !== "number" || !Number.isFinite(iva) || iva < 0 || iva > 100) {
    return falla("itemAlegraIva", "Ingrese una alícuota de IVA entre 0 y 100.")
  }

  const orden = body.orden === undefined ? 0 : body.orden
  if (typeof orden !== "number" || !Number.isInteger(orden) || orden < 0 || orden > 32000) return falla("orden", "El orden del método no es válido.")

  // ── Zonas ──
  if (!Array.isArray(body.zonas) || body.zonas.length > MAX_ZONAS) return falla("zonas", `Cargue entre 1 y ${MAX_ZONAS} zonas.`)
  if (activo && body.zonas.length === 0) return falla("zonas", "Para activar el método cargue al menos una zona.")

  const zonas: ZonaValidada[] = []
  const nombresVistos = new Set<string>()
  const entradasVistas = new Map<string, string>() // "tipo:valor" → nombre de la zona
  for (let i = 0; i < body.zonas.length; i++) {
    const z = body.zonas[i]
    if (!esObjeto(z)) return falla(`zonas.${i}`, "Una de las zonas no es válida.")
    const nombreZona = texto(z.nombre, 60)
    if (!nombreZona) return falla(`zonas.${i}.nombre`, "Ingrese el nombre de la zona (hasta 60 caracteres).")
    const claveNombre = claveTexto(nombreZona)
    if (nombresVistos.has(claveNombre)) return falla(`zonas.${i}.nombre`, `Ya existe una zona llamada «${nombreZona}» en este método.`)
    nombresVistos.add(claveNombre)

    const precio = parsearPrecio(z.precio)
    if (precio === null) return falla(`zonas.${i}.precio`, `Ingrese un precio mayor a cero para la zona «${nombreZona}».`)

    const ordenZona = z.orden === undefined ? i : z.orden
    if (typeof ordenZona !== "number" || !Number.isInteger(ordenZona) || ordenZona < 0 || ordenZona > 32000) {
      return falla(`zonas.${i}.orden`, `El orden de la zona «${nombreZona}» no es válido.`)
    }

    const g = validarGeometria(z.geometria === undefined ? [] : z.geometria)
    if (!g.ok) return falla(`zonas.${i}.geometria`, `Zona «${nombreZona}»: ${g.error}`)

    const crudas = z.entradas === undefined ? [] : z.entradas
    if (!Array.isArray(crudas) || crudas.length > MAX_ENTRADAS_POR_ZONA) return falla(`zonas.${i}.entradas`, `La zona «${nombreZona}» admite hasta ${MAX_ENTRADAS_POR_ZONA} localidades o códigos postales.`)
    const entradas: EntradaValidada[] = []
    for (const e of crudas) {
      if (!esObjeto(e) || (e.tipo !== "georef" && e.tipo !== "cp") || typeof e.valor !== "string") {
        return falla(`zonas.${i}.entradas`, `Zona «${nombreZona}»: hay una localidad o un código postal que no es válido.`)
      }
      const valor = e.tipo === "cp" ? normalizarCp(e.valor) : e.valor.trim()
      const formatoOk = e.tipo === "georef" ? /^[0-9]{1,12}$/.test(valor) : /^([0-9]{4}|[A-Z][0-9]{4}[A-Z]{3})$/.test(valor)
      if (!formatoOk) {
        return falla(
          `zonas.${i}.entradas`,
          e.tipo === "cp"
            ? `Zona «${nombreZona}»: el código postal «${e.valor.trim()}» no es válido (4 dígitos o formato CPA).`
            : `Zona «${nombreZona}»: la localidad indicada no es válida. Búsquela y seleccione una de la lista.`,
        )
      }
      const clave = `${e.tipo}:${valor}`
      const previa = entradasVistas.get(clave)
      if (previa !== undefined) {
        const donde = previa === nombreZona ? "en esta misma zona" : `en la zona «${previa}»`
        return falla(`zonas.${i}.entradas`, `${e.tipo === "cp" ? `El código postal ${valor}` : "Esa localidad"} ya está cargado ${donde}. Una entrada pertenece a una sola zona.`)
      }
      entradasVistas.set(clave, nombreZona)
      const etiqueta = typeof e.etiqueta === "string" && e.etiqueta.trim() ? e.etiqueta.trim().slice(0, 120) : e.tipo === "cp" ? `CP ${valor}` : `Localidad ${valor}`
      entradas.push({ tipo: e.tipo, valor, etiqueta })
    }

    if (g.g.length === 0 && entradas.length === 0) {
      return falla(`zonas.${i}`, `La zona «${nombreZona}» no tiene dibujo en el mapa ni localidades o códigos postales. Dibuje su área o agregue al menos uno.`)
    }
    const id = typeof z.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(z.id) ? z.id.toLowerCase() : undefined
    zonas.push({ ...(id && { id }), nombre: nombreZona, precio, orden: ordenZona, activa: z.activa !== false, geometria: g.g, entradas })
  }

  // ── Localidades atendidas ──
  const crudasLoc = body.localidades === undefined ? [] : body.localidades
  if (!Array.isArray(crudasLoc) || crudasLoc.length > MAX_LOCALIDADES) return falla("localidades", `Se admiten hasta ${MAX_LOCALIDADES} localidades atendidas.`)
  const localidades: LocalidadValidada[] = []
  const idsVistos = new Set<string>()
  for (let i = 0; i < crudasLoc.length; i++) {
    const l = crudasLoc[i]
    if (!esObjeto(l) || typeof l.georefId !== "string" || !/^[0-9]{1,12}$/.test(l.georefId.trim())) {
      return falla(`localidades.${i}.georefId`, "Una de las localidades atendidas no es válida. Búsquela y seleccione una de la lista.")
    }
    const georefId = l.georefId.trim()
    if (idsVistos.has(georefId)) return falla(`localidades.${i}.georefId`, "Hay una localidad atendida repetida.")
    idsVistos.add(georefId)
    const etiqueta = texto(l.etiqueta, 120)
    if (!etiqueta) return falla(`localidades.${i}.etiqueta`, "Falta el nombre de una de las localidades atendidas.")
    const abrev = l.abreviaturas === undefined ? [] : l.abreviaturas
    if (!Array.isArray(abrev) || abrev.length > 10 || !abrev.every((a) => typeof a === "string" && claveTexto(a).length >= 1 && a.trim().length <= 20)) {
      return falla(`localidades.${i}.abreviaturas`, `Las abreviaturas de «${etiqueta}» no son válidas (hasta 10, de hasta 20 caracteres).`)
    }
    localidades.push({ georefId, etiqueta, abreviaturas: [...new Set((abrev as string[]).map((a) => claveTexto(a)))].filter(Boolean) })
  }

  // ── Avisos: polígonos que se pisan (gana la zona de menor orden) ──
  const avisos: string[] = []
  const conArea = zonas.filter((z) => z.geometria.length > 0)
  for (let a = 0; a < conArea.length; a++) {
    for (let b = a + 1; b < conArea.length; b++) {
      if (seSolapan(conArea[a].geometria, conArea[b].geometria)) {
        const [primera, segunda] = [conArea[a], conArea[b]].sort((x, y) => x.orden - y.orden)
        avisos.push(`Las zonas «${conArea[a].nombre}» y «${conArea[b].nombre}» se superponen: en el área común rige «${primera.nombre}» (menor orden) por sobre «${segunda.nombre}».`)
      }
    }
  }

  return {
    ok: true,
    avisos,
    metodo: {
      slug: slugCrudo,
      nombre,
      activo,
      orden,
      provinciaClave,
      provincia,
      sucursalOrigen,
      diasOperativos,
      horaCorte,
      margenMin,
      promesa,
      avisoFeriados,
      horarioEntrega,
      feriados,
      gratisAplica,
      itemAlegraId,
      itemAlegraIva: iva,
      zonas,
      localidades,
    },
  }
}
