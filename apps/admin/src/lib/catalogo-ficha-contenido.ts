import { createHash } from "node:crypto"
import { fichaContenidoKey } from "./shop-media"
import type { FichaTecnicaOverlay } from "@/db/schema"

// Lógica PURA de las fichas técnicas por contenido: el plan (qué objetos de R2 hacen falta y a
// cuál apunta cada producto), la aplicación contra deps inyectadas (BD y R2 falsos en los tests),
// el revertir y el listado de respaldos. Sin red ni base acá: las usan el script
// `scripts/fichas-catalogo.ts` y sus tests.

export const MAX_BYTES_FICHA = 10 * 1024 * 1024

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

// ─── Plan ────────────────────────────────────────────────────────────────────────────────

/** Una entrada de `indice.json`: un PDF local y los productos que hoy tienen una copia de él. */
export interface EntradaIndice {
  archivo: string
  bytes: number
  productos: { id: string }[]
}

export interface ObjetoPlan {
  key: string
  sha256: string
  bytes: number
  /** Un archivo local que tiene este contenido (el que se sube). */
  archivo: string
  /** Cuántos productos del plan apuntan a este objeto. */
  productos: number
}

export interface ProductoPlan {
  id: string
  key: string
  sha256: string
  bytes: number
  archivo: string
}

export interface PlanFichasR2 {
  version: 1
  tenant: string
  generado: string
  objetos: ObjetoPlan[]
  productos: ProductoPlan[]
  /** Archivos del índice que no estaban en disco o no se pudieron leer. */
  faltantes: string[]
  resumen: {
    archivosLeidos: number
    productos: number
    productosRepetidos: number
    objetos: number
    bytesObjetos: number
    /** Lo que pesan hoy las copias por producto (suma de bytes por producto). */
    bytesCopiasPorProducto: number
    bytesAhorrados: number
    /** Productos cuyo objeto lo usan también otros productos. */
    productosConObjetoCompartido: number
    /** Productos con un PDF que no comparte con nadie. */
    productosConObjetoPropio: number
  }
}

export interface DepsPlan {
  /** Hashea el PDF local; null si no está o no se puede leer. */
  hashear(archivo: string): Promise<{ sha256: string; bytes: number } | null>
  ahora?: () => Date
}

export async function planificarFichas(tenant: string, indice: EntradaIndice[], deps: DepsPlan): Promise<PlanFichasR2> {
  const objetos = new Map<string, ObjetoPlan>()
  const productos: ProductoPlan[] = []
  const vistos = new Set<string>()
  const faltantes: string[] = []
  let repetidos = 0
  let leidos = 0
  let bytesCopias = 0

  for (const entrada of indice) {
    const h = await deps.hashear(entrada.archivo)
    if (!h) {
      faltantes.push(entrada.archivo)
      continue
    }
    leidos++
    const key = fichaContenidoKey(tenant, h.sha256)
    let objeto = objetos.get(key)
    if (!objeto) {
      objeto = { key, sha256: h.sha256, bytes: h.bytes, archivo: entrada.archivo, productos: 0 }
      objetos.set(key, objeto)
    }
    for (const p of entrada.productos) {
      if (vistos.has(p.id)) {
        repetidos++
        continue
      }
      vistos.add(p.id)
      objeto.productos++
      bytesCopias += h.bytes
      productos.push({ id: p.id, key, sha256: h.sha256, bytes: h.bytes, archivo: entrada.archivo })
    }
  }

  const lista = [...objetos.values()].filter((o) => o.productos > 0)
  const bytesObjetos = lista.reduce((n, o) => n + o.bytes, 0)
  return {
    version: 1,
    tenant,
    generado: (deps.ahora?.() ?? new Date()).toISOString(),
    objetos: lista,
    productos,
    faltantes,
    resumen: {
      archivosLeidos: leidos,
      productos: productos.length,
      productosRepetidos: repetidos,
      objetos: lista.length,
      bytesObjetos,
      bytesCopiasPorProducto: bytesCopias,
      bytesAhorrados: bytesCopias - bytesObjetos,
      productosConObjetoCompartido: lista.filter((o) => o.productos > 1).reduce((n, o) => n + o.productos, 0),
      productosConObjetoPropio: lista.filter((o) => o.productos === 1).length,
    },
  }
}

// ─── Aplicar ─────────────────────────────────────────────────────────────────────────────

export interface DepsAplicar {
  leerFicha(tenant: string, alegraId: string): Promise<FichaTecnicaOverlay | null>
  /** Compare-and-swap sobre la key vigente. true = cambió. */
  cambiarSiVigente(tenant: string, alegraId: string, keyVigente: string, nueva: FichaTecnicaOverlay): Promise<boolean>
  /** null = en dry-run sin R2 configurado: no se verifica qué hay en el bucket. */
  r2: {
    head(key: string): Promise<{ size: number } | null>
    put(key: string, body: Uint8Array, o: { contentType: string }): Promise<void>
  } | null
  leerPdf(archivo: string): Promise<Uint8Array>
  log?: (linea: string) => void
}

export interface OpcionesAplicar {
  ejecutar: boolean
  limite?: number
  productos?: string[]
}

export interface ResultadoAplicar {
  ejecutado: boolean
  actualizados: number
  yaAplicados: number
  /** Productos que se actualizarían (en --ejecutar, los que se intentaron). */
  aActualizar: number
  sinFicha: number
  cambioDesdeElIndice: number
  casFallido: number
  errores: { id: string; motivo: string }[]
  objetosSubidos: number
  bytesSubidos: number
  objetosYaEnR2: number
  /** Dry-run: objetos que habría que subir. */
  objetosPorSubir: number
}

export async function aplicarPlan(plan: PlanFichasR2, opts: OpcionesAplicar, deps: DepsAplicar): Promise<ResultadoAplicar> {
  const r: ResultadoAplicar = {
    ejecutado: opts.ejecutar,
    actualizados: 0,
    yaAplicados: 0,
    aActualizar: 0,
    sinFicha: 0,
    cambioDesdeElIndice: 0,
    casFallido: 0,
    errores: [],
    objetosSubidos: 0,
    bytesSubidos: 0,
    objetosYaEnR2: 0,
    objetosPorSubir: 0,
  }
  const asegurados = new Set<string>() // objetos ya presentes en R2 en esta corrida
  const contados = new Set<string>()
  const filtro = opts.productos ? new Set(opts.productos) : null
  let tratados = 0

  for (const p of plan.productos) {
    if (filtro && !filtro.has(p.id)) continue
    if (opts.limite !== undefined && tratados >= opts.limite) break

    const ficha = await deps.leerFicha(plan.tenant, p.id)
    if (!ficha) {
      r.sinFicha++
      continue
    }
    if (ficha.key === p.key) {
      r.yaAplicados++
      continue
    }
    // El PDF local sale de la descarga de la copia de este producto: si hoy la copia pesa otra
    // cosa, alguien la cambió después y el archivo local ya no es lo que está cargado.
    if (ficha.bytes !== p.bytes) {
      r.cambioDesdeElIndice++
      deps.log?.(`  ${p.id}: la ficha cambió desde el índice (${ficha.bytes} B vs ${p.bytes} B), se saltea`)
      continue
    }
    tratados++

    try {
      if (!asegurados.has(p.key)) {
        const existente = deps.r2 ? await deps.r2.head(p.key) : null
        if (existente) {
          if (existente.size !== p.bytes) {
            throw new Error(`el objeto ${p.key} ya existe con otro tamaño (${existente.size} B vs ${p.bytes} B)`)
          }
          asegurados.add(p.key)
          r.objetosYaEnR2++
        } else if (opts.ejecutar) {
          if (!deps.r2) throw new Error("falta la configuración de R2")
          const pdf = await deps.leerPdf(p.archivo)
          if (pdf.byteLength !== p.bytes || sha256Hex(pdf) !== p.sha256) {
            throw new Error(`el archivo local ${p.archivo} ya no coincide con el plan (volver a planificar)`)
          }
          await deps.r2.put(p.key, pdf, { contentType: "application/pdf" })
          asegurados.add(p.key)
          r.objetosSubidos++
          r.bytesSubidos += pdf.byteLength
        } else if (!contados.has(p.key)) {
          contados.add(p.key)
          r.objetosPorSubir++
        }
      }

      r.aActualizar++
      if (!opts.ejecutar) continue

      const nueva: FichaTecnicaOverlay = {
        key: p.key,
        nombre: ficha.nombre,
        bytes: p.bytes,
        sha256: p.sha256,
        // Si ya había respaldo se conserva (es la copia ORIGINAL); si no, la copia de hoy.
        origen: ficha.origen ?? { key: ficha.key, bytes: ficha.bytes },
      }
      if (await deps.cambiarSiVigente(plan.tenant, p.id, ficha.key, nueva)) r.actualizados++
      else {
        r.casFallido++
        deps.log?.(`  ${p.id}: la ficha cambió mientras tanto, no se pisa`)
      }
    } catch (err) {
      r.errores.push({ id: p.id, motivo: err instanceof Error ? err.message : String(err) })
    }
  }
  return r
}

// ─── Revertir ────────────────────────────────────────────────────────────────────────────

export interface DepsRevertir {
  leerFicha: DepsAplicar["leerFicha"]
  cambiarSiVigente: DepsAplicar["cambiarSiVigente"]
  r2: { head(key: string): Promise<{ size: number } | null> }
  log?: (linea: string) => void
}

export interface ResultadoRevertir {
  ejecutado: boolean
  revertidos: number
  aRevertir: number
  sinOrigen: number
  origenNoExiste: number
  yaRevertidos: number
  casFallido: number
}

/** Devuelve cada producto del plan a su copia original (`origen.key`). No borra nada de R2. */
export async function revertirPlan(plan: PlanFichasR2, opts: OpcionesAplicar, deps: DepsRevertir): Promise<ResultadoRevertir> {
  const r: ResultadoRevertir = {
    ejecutado: opts.ejecutar,
    revertidos: 0,
    aRevertir: 0,
    sinOrigen: 0,
    origenNoExiste: 0,
    yaRevertidos: 0,
    casFallido: 0,
  }
  const filtro = opts.productos ? new Set(opts.productos) : null
  let tratados = 0
  for (const p of plan.productos) {
    if (filtro && !filtro.has(p.id)) continue
    if (opts.limite !== undefined && tratados >= opts.limite) break
    const ficha = await deps.leerFicha(plan.tenant, p.id)
    if (!ficha) continue
    if (!ficha.origen) {
      r.sinOrigen++
      continue
    }
    if (ficha.key === ficha.origen.key) {
      r.yaRevertidos++
      continue
    }
    tratados++
    if (!(await deps.r2.head(ficha.origen.key))) {
      r.origenNoExiste++
      deps.log?.(`  ${p.id}: la copia original ya no está en el bucket, no se revierte`)
      continue
    }
    r.aRevertir++
    if (!opts.ejecutar) continue
    const vuelta: FichaTecnicaOverlay = { key: ficha.origen.key, nombre: ficha.nombre, bytes: ficha.origen.bytes }
    if (await deps.cambiarSiVigente(plan.tenant, p.id, ficha.key, vuelta)) r.revertidos++
    else r.casFallido++
  }
  return r
}

// ─── Huérfanos (solo listar) ─────────────────────────────────────────────────────────────

export interface RespaldoSinUso {
  key: string
  bytes: number
  productos: number
}

/**
 * Keys que quedaron como respaldo (`origen`) y que NINGÚN producto usa como ficha vigente. Son las
 * copias viejas candidatas a borrarse; borrarlas es un paso aparte, con OK explícito, y deja sin
 * efecto el `revertir` de esos productos.
 */
export function calcularRespaldosSinUso(fichas: { alegraId: string; ficha: FichaTecnicaOverlay }[]): RespaldoSinUso[] {
  const vigentes = new Set(fichas.map((f) => f.ficha.key))
  const porKey = new Map<string, RespaldoSinUso>()
  for (const { ficha } of fichas) {
    const o = ficha.origen
    if (!o || vigentes.has(o.key)) continue
    const previo = porKey.get(o.key)
    if (previo) previo.productos++
    else porKey.set(o.key, { key: o.key, bytes: o.bytes, productos: 1 })
  }
  return [...porKey.values()].sort((a, b) => a.key.localeCompare(b.key))
}
