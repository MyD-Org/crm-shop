/**
 * Lectura local de atributos desde PDF: ni API ni base en la verificación.
 *
 * Los subagentes de Claude Code leen los PDFs de `<dir>/pdfs` y `<dir>/recortes` y escriben
 * `<dir>/lectura/crudo/*.jsonl` (formato `LecturaCruda`, ver `scripts/README-atributos-pdf.md`).
 * `verificarDirectorio` aplica las reglas de rigor (`catalogo-atributos-verificacion.ts`) y escribe
 * `<dir>/lectura/aceptados.jsonl` + `descartes.jsonl`. `aplicarAceptados` sube a la base sólo lo
 * aceptado (fuente 'pdf', respetando manual > pdf > nombre).
 *
 * El contenido de `crudo/` es un DATO no confiable: se valida forma, ruta (no se sale de `<dir>`) y
 * cada valor antes de usarlo.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  CLAVES_ATRIBUTO,
  DEFINICION_ATRIBUTOS,
  normalizarAtributos,
  type AtributoExtraido,
  type ClaveAtributo,
} from "./catalogo-atributos-extraccion"
import {
  consolidar,
  verificarLectura,
  type LecturaCruda,
  type Motivo,
} from "./catalogo-atributos-verificacion"
import { extraerItemsPaginas, type ItemTexto } from "./catalogo-ficha-texto"

// ───────────────────────── formatos de archivo ─────────────────────────

export interface IndiceLocal {
  archivo: string
  bytes: number
  productos: { id: string; code: string | null; nombre: string; marca?: string | null }[]
}

export interface LineaAceptada {
  id: string
  clave: ClaveAtributo
  valorNum: number | null
  valorTexto: string | null
  /** Cita del modelo (informativa). */
  cita: string | null
  fila: string | null
  pdf: string
  /** Regla que lo aceptó, texto del PDF que lo respalda y página (para revisar a ojo). */
  regla: string
  evidencia: string
  pagina: number
  citaEnTexto: boolean
}

export interface LineaDescarte {
  id: string | null
  pdf: string | null
  fila: string | null
  clave: string | null
  motivo: Motivo
  valor: unknown
  cita: unknown
  detalle?: string
}

export interface ResumenVerificacion {
  lecturas: number
  porClave: Record<string, { aceptados: number; descartados: number }>
  porMotivo: Record<string, number>
}

export interface OpcionesVerificacion {
  /** Extractor de texto (por defecto `unpdf`); inyectable en tests. */
  extraer?: (bytes: Uint8Array) => Promise<ItemTexto[][]>
}

const jsonl = (xs: readonly unknown[]) => xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : "")

/** Línea JSON → `LecturaCruda` o null si la forma no es la esperada. */
export function parsearLecturaCruda(linea: string): LecturaCruda | null {
  let o: unknown
  try {
    o = JSON.parse(linea)
  } catch {
    return null
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null
  const r = o as Record<string, unknown>
  if (typeof r.id !== "string" || !r.id || typeof r.pdf !== "string" || !r.pdf) return null
  if (r.fila != null && typeof r.fila !== "string") return null
  if (!r.atributos || typeof r.atributos !== "object" || Array.isArray(r.atributos)) return null
  const atributos: LecturaCruda["atributos"] = {}
  for (const [k, v] of Object.entries(r.atributos as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null
    const a = v as Record<string, unknown>
    atributos[k] = { valor: a.valor, cita: a.cita }
  }
  return { id: r.id, pdf: r.pdf, fila: (r.fila as string | null | undefined) ?? null, atributos }
}

// ───────────────────────── verificación del directorio ─────────────────────────

export async function verificarDirectorio(dir: string, opciones: OpcionesVerificacion = {}): Promise<ResumenVerificacion> {
  const extraer = opciones.extraer ?? extraerItemsPaginas
  const raiz = path.resolve(dir)
  const indice = JSON.parse(await readFile(path.join(raiz, "indice.json"), "utf8")) as IndiceLocal[]
  const productos = new Map<string, { code: string | null; nombre: string }>()
  const productosPorArchivo = new Map<string, number>()
  for (const e of indice) {
    productosPorArchivo.set(e.archivo, e.productos.length)
    for (const p of e.productos) productos.set(String(p.id), { code: p.code ?? null, nombre: p.nombre })
  }

  const dirCrudo = path.join(raiz, "lectura", "crudo")
  const archivos = (await readdir(dirCrudo).catch(() => [] as string[])).filter((f) => f.endsWith(".jsonl")).sort()

  const textos = new Map<string, ItemTexto[][] | Motivo>()
  const textoDe = async (abs: string): Promise<ItemTexto[][] | Motivo> => {
    const hit = textos.get(abs)
    if (hit) return hit
    let r: ItemTexto[][] | Motivo
    let bytes: Buffer | null = null
    try {
      bytes = await readFile(abs)
    } catch {
      r = "pdf_inexistente"
    }
    if (bytes) {
      try {
        r = await extraer(new Uint8Array(bytes))
      } catch {
        r = "pdf_ilegible"
      }
    }
    textos.set(abs, r!)
    return r!
  }

  const aceptadosBrutos: LineaAceptada[] = []
  const descartes: LineaDescarte[] = []
  let lecturas = 0

  for (const archivo of archivos) {
    const lineas = (await readFile(path.join(dirCrudo, archivo), "utf8")).split("\n")
    for (const [i, linea] of lineas.entries()) {
      if (!linea.trim()) continue
      lecturas++
      const l = parsearLecturaCruda(linea)
      if (!l) {
        descartes.push({ id: null, pdf: null, fila: null, clave: null, motivo: "linea_invalida", valor: null, cita: null, detalle: `${archivo}:${i + 1}` })
        continue
      }
      const descartarTodo = (motivo: Motivo) => {
        for (const [clave, a] of Object.entries(l.atributos)) {
          descartes.push({ id: l.id, pdf: l.pdf, fila: l.fila, clave, motivo, valor: a.valor, cita: a.cita })
        }
        if (Object.keys(l.atributos).length === 0) {
          descartes.push({ id: l.id, pdf: l.pdf, fila: l.fila, clave: null, motivo, valor: null, cita: null })
        }
      }

      const producto = productos.get(l.id)
      if (!producto) {
        descartarTodo("producto_desconocido")
        continue
      }
      const abs = path.resolve(raiz, l.pdf)
      if (!abs.startsWith(raiz + path.sep)) {
        descartarTodo("pdf_fuera_del_directorio")
        continue
      }
      const rel = path.relative(raiz, abs).split(path.sep).join("/")
      const texto = await textoDe(abs)
      if (typeof texto === "string") {
        descartarTodo(texto)
        continue
      }
      const unicoProducto = rel.startsWith("pdfs/") && productosPorArchivo.get(path.basename(rel)) === 1
      const r = verificarLectura(l, { code: producto.code, nombre: producto.nombre, paginas: texto, unicoProducto })
      for (const a of r.aceptados) {
        aceptadosBrutos.push({ id: l.id, clave: a.clave, valorNum: a.valorNum, valorTexto: a.valorTexto, cita: a.cita, fila: l.fila, pdf: rel, regla: a.regla, evidencia: a.evidencia, pagina: a.pagina, citaEnTexto: a.citaEnTexto })
      }
      for (const d of r.descartes) {
        descartes.push({ id: l.id, pdf: l.pdf, fila: l.fila, clave: d.clave, motivo: d.motivo, valor: d.valor, cita: d.cita })
      }
    }
  }

  const { aceptados, conflictos } = consolidar(aceptadosBrutos)
  for (const c of conflictos) {
    descartes.push({ id: c.id, pdf: c.pdf, fila: c.fila, clave: c.clave, motivo: "conflicto_entre_lecturas", valor: c.valorNum ?? c.valorTexto, cita: c.cita })
  }

  await mkdir(path.join(raiz, "lectura"), { recursive: true })
  await writeFile(path.join(raiz, "lectura", "aceptados.jsonl"), jsonl(aceptados))
  await writeFile(path.join(raiz, "lectura", "descartes.jsonl"), jsonl(descartes))

  const porClave: ResumenVerificacion["porClave"] = {}
  const sumar = (clave: string, campo: "aceptados" | "descartados") => {
    porClave[clave] ??= { aceptados: 0, descartados: 0 }
    porClave[clave][campo]++
  }
  for (const a of aceptados) sumar(a.clave, "aceptados")
  const porMotivo: Record<string, number> = {}
  for (const d of descartes) {
    if (d.clave) sumar(d.clave, "descartados")
    porMotivo[d.motivo] = (porMotivo[d.motivo] ?? 0) + 1
  }
  return { lecturas, porClave, porMotivo }
}

export function formatearResumenVerificacion(r: ResumenVerificacion): string {
  const claves = [...CLAVES_ATRIBUTO.filter((c) => r.porClave[c]), ...Object.keys(r.porClave).filter((c) => !(CLAVES_ATRIBUTO as readonly string[]).includes(c))]
  const lineas = [`lecturas=${r.lecturas}`, "por clave (aceptados / descartados):"]
  for (const c of claves) lineas.push(`  ${c}: ${r.porClave[c].aceptados} / ${r.porClave[c].descartados}`)
  lineas.push("descartes por motivo:")
  const motivos = Object.entries(r.porMotivo).sort((a, b) => b[1] - a[1])
  if (motivos.length === 0) lineas.push("  (ninguno)")
  for (const [m, n] of motivos) lineas.push(`  ${m}: ${n}`)
  return lineas.join("\n")
}

// ───────────────────────── aplicación a la base ─────────────────────────

/** Línea de `aceptados.jsonl` → fila válida, o null. Se re-valida con `normalizarAtributos`: el archivo es un dato. */
export function parsearAceptado(linea: string): { id: string; atributo: AtributoExtraido } | null {
  let o: unknown
  try {
    o = JSON.parse(linea)
  } catch {
    return null
  }
  if (!o || typeof o !== "object") return null
  const r = o as Record<string, unknown>
  if (typeof r.id !== "string" || !r.id || typeof r.clave !== "string") return null
  if (!(CLAVES_ATRIBUTO as readonly string[]).includes(r.clave)) return null
  const clave = r.clave as ClaveAtributo
  // La tensión y la corriente pueden traer un rango en texto ("85-265", "4-6"): manda el texto.
  const conRango = clave === "tension_v" || clave === "corriente_a"
  const bruto = DEFINICION_ATRIBUTOS[clave].tipo === "num" && !conRango ? r.valorNum : (r.valorTexto ?? r.valorNum)
  const valido = normalizarAtributos({ [clave]: bruto }).find((a) => a.clave === clave)
  if (!valido) return null
  return { id: r.id, atributo: valido }
}

export interface ExistenteAtributo {
  fuente: "nombre" | "pdf" | "manual"
  valorNum: number | null
  valorTexto: string | null
}

export interface DepsAplicar {
  /** Filas actuales de esos productos, por clave `id|clave`. */
  leerExistentes(tenantId: string, ids: string[]): Promise<Map<string, ExistenteAtributo>>
  /** Upsert fuente 'pdf' con precedencia; devuelve cuántas filas quedaron escritas. */
  upsertPdf(tenantId: string, filas: { alegraId: string; clave: ClaveAtributo; valorNum: number | null; valorTexto: string | null }[]): Promise<number>
  /** Aviso al Shop para que revalide el catálogo (se llama sólo si se escribió algo). Opcional. */
  avisarShop?(tenantId: string): Promise<{ propagado: boolean }>
}

export interface ResumenAplicar {
  lineas: number
  invalidas: number
  conflictos: number
  porClave: Record<string, number>
  nuevas: number
  cambian: number
  confirmanNombre: number
  iguales: number
  protegidasManual: number
  escritas: number | null
  /** Resultado del aviso al Shop (null si no se escribió nada o no hay aviso). */
  avisoShop: "entregado" | "no entregado" | "falló" | null
}

const mismoValor = (a: AtributoExtraido, b: ExistenteAtributo) =>
  (a.valorNum === b.valorNum || (a.valorNum != null && b.valorNum != null && Math.abs(a.valorNum - b.valorNum) < 1e-9)) &&
  a.valorTexto === b.valorTexto

export async function aplicarAceptados(
  contenido: string,
  tenantId: string,
  deps: DepsAplicar,
  aplicar: boolean,
): Promise<ResumenAplicar> {
  const validas: { id: string; clave: ClaveAtributo; valorNum: number | null; valorTexto: string | null }[] = []
  let lineas = 0
  let invalidas = 0
  for (const linea of contenido.split("\n")) {
    if (!linea.trim()) continue
    lineas++
    const p = parsearAceptado(linea)
    if (!p) {
      invalidas++
      continue
    }
    validas.push({ id: p.id, clave: p.atributo.clave, valorNum: p.atributo.valorNum, valorTexto: p.atributo.valorTexto })
  }
  // Una respuesta por (producto, clave); si el archivo trae dos distintas no se carga ninguna.
  const { aceptados, conflictos } = consolidar(validas)
  const conflictivas = new Set(conflictos.map((c) => `${c.id}|${c.clave}`))
  const filas = aceptados.filter((a) => !conflictivas.has(`${a.id}|${a.clave}`))

  const existentes = filas.length ? await deps.leerExistentes(tenantId, [...new Set(filas.map((f) => f.id))]) : new Map()
  const r: ResumenAplicar = {
    lineas,
    invalidas,
    conflictos: conflictivas.size,
    porClave: {},
    nuevas: 0,
    cambian: 0,
    confirmanNombre: 0,
    iguales: 0,
    protegidasManual: 0,
    escritas: null,
    avisoShop: null,
  }
  for (const f of filas) {
    r.porClave[f.clave] = (r.porClave[f.clave] ?? 0) + 1
    const e = existentes.get(`${f.id}|${f.clave}`)
    if (!e) r.nuevas++
    else if (e.fuente === "manual") r.protegidasManual++
    else if (mismoValor(f, e)) {
      if (e.fuente === "pdf") r.iguales++
      else r.confirmanNombre++
    } else r.cambian++
  }
  if (aplicar && filas.length) {
    r.escritas = await deps.upsertPdf(
      tenantId,
      filas.map((f) => ({ alegraId: f.id, clave: f.clave, valorNum: f.valorNum, valorTexto: f.valorTexto })),
    )
  } else if (aplicar) {
    r.escritas = 0
  }
  // Avisar al Shop después de escribir; que el ping falle no tumba la carga (el cambio ya está en la base).
  if (r.escritas && deps.avisarShop) {
    try {
      r.avisoShop = (await deps.avisarShop(tenantId)).propagado ? "entregado" : "no entregado"
    } catch (err) {
      r.avisoShop = "falló"
      console.warn(`[atributos-pdf] no se pudo avisar al Shop: ${err instanceof Error ? err.name : "error"}`)
    }
  }
  return r
}

export function formatearResumenAplicar(r: ResumenAplicar, aplicar: boolean): string {
  const orden = CLAVES_ATRIBUTO.filter((c) => r.porClave[c]).map((c) => `${c}=${r.porClave[c]}`)
  return [
    `lineas=${r.lineas} invalidas=${r.invalidas} conflictos=${r.conflictos}`,
    `por clave: ${orden.join(" ") || "(ninguna)"}`,
    `nuevas=${r.nuevas} cambian=${r.cambian} confirmanNombre=${r.confirmanNombre} iguales=${r.iguales} protegidasManual=${r.protegidasManual}`,
    aplicar
      ? `escritas=${r.escritas}${r.avisoShop ? `\naviso al Shop: ${r.avisoShop === "entregado" ? "entregado" : "no entregado (el cambio igual ya está en la base)"}` : ""}`
      : "dry-run: no se escribió nada (usar --aplicar)",
  ].join("\n")
}
