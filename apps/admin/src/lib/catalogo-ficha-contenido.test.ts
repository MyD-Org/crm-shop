import { describe, expect, it } from "vitest"
import type { FichaTecnicaOverlay } from "@/db/schema"
import {
  aplicarPlan,
  calcularRespaldosSinUso,
  planificarFichas,
  revertirPlan,
  sha256Hex,
  type DepsAplicar,
  type PlanFichasR2,
} from "./catalogo-ficha-contenido"

const T = "tenant-ejemplo"
const enc = (s: string) => new TextEncoder().encode(s)

// PDFs falsos en memoria: el contenido es lo único que importa para el sha256.
const PDFS: Record<string, Uint8Array> = {
  "a.pdf": enc("%PDF contenido uno"),
  "b.pdf": enc("%PDF contenido dos, más largo"),
  "c.pdf": enc("%PDF contenido uno"), // mismo contenido que a.pdf
}

const hashear = async (archivo: string) => {
  const b = PDFS[archivo]
  return b ? { sha256: sha256Hex(b), bytes: b.byteLength } : null
}

const indice = [
  { archivo: "a.pdf", bytes: PDFS["a.pdf"].byteLength, productos: [{ id: "1" }, { id: "2" }] },
  { archivo: "b.pdf", bytes: PDFS["b.pdf"].byteLength, productos: [{ id: "3" }] },
  { archivo: "c.pdf", bytes: PDFS["c.pdf"].byteLength, productos: [{ id: "4" }] },
  { archivo: "falta.pdf", bytes: 10, productos: [{ id: "5" }] },
]

describe("planificarFichas", () => {
  it("un objeto por contenido distinto; archivos con el mismo contenido comparten objeto", async () => {
    const plan = await planificarFichas(T, indice, { hashear, ahora: () => new Date("2026-10-01T00:00:00Z") })

    expect(plan.objetos).toHaveLength(2)
    const shaA = sha256Hex(PDFS["a.pdf"])
    const objA = plan.objetos.find((o) => o.sha256 === shaA)!
    expect(objA).toMatchObject({ key: `productos/${T}/fichas/${shaA}.pdf`, archivo: "a.pdf", productos: 3 })
    expect(plan.productos.map((p) => [p.id, p.key])).toEqual([
      ["1", objA.key],
      ["2", objA.key],
      ["3", `productos/${T}/fichas/${sha256Hex(PDFS["b.pdf"])}.pdf`],
      ["4", objA.key],
    ])
    expect(plan.faltantes).toEqual(["falta.pdf"])
  })

  it("el resumen cuenta bytes, ahorro y productos compartidos/propios", async () => {
    const plan = await planificarFichas(T, indice, { hashear })
    const a = PDFS["a.pdf"].byteLength
    const b = PDFS["b.pdf"].byteLength
    expect(plan.resumen).toMatchObject({
      archivosLeidos: 3,
      productos: 4,
      objetos: 2,
      bytesObjetos: a + b,
      bytesCopiasPorProducto: 3 * a + b,
      bytesAhorrados: 2 * a,
      productosConObjetoCompartido: 3,
      productosConObjetoPropio: 1,
    })
  })

  it("un producto repetido en dos entradas cuenta una sola vez (gana el primero)", async () => {
    const plan = await planificarFichas(
      T,
      [
        { archivo: "a.pdf", bytes: 1, productos: [{ id: "1" }] },
        { archivo: "b.pdf", bytes: 1, productos: [{ id: "1" }, { id: "2" }] },
      ],
      { hashear },
    )
    expect(plan.productos.map((p) => p.id)).toEqual(["1", "2"])
    expect(plan.productos[0].archivo).toBe("a.pdf")
    expect(plan.resumen.productosRepetidos).toBe(1)
  })

  it("el plan no lleva nombres ni códigos de producto", async () => {
    const plan = await planificarFichas(
      T,
      [{ archivo: "a.pdf", bytes: 1, productos: [{ id: "1", code: "990101001A-XYZ", nombre: "Producto ficticio" } as { id: string }] }],
      { hashear },
    )
    expect(JSON.stringify(plan)).not.toMatch(/990101001A|ficticio/)
  })
})

// ─── Fakes de BD y R2 ────────────────────────────────────────────────────────────────────

function fake(fichas: Record<string, FichaTecnicaOverlay | null>, bucket: Record<string, number> = {}) {
  const puts: string[] = []
  const heads: string[] = []
  const deps: DepsAplicar = {
    leerFicha: async (_t, id) => fichas[id] ?? null,
    cambiarSiVigente: async (_t, id, vigente, nueva) => {
      if (fichas[id]?.key !== vigente) return false
      fichas[id] = nueva
      return true
    },
    r2: {
      head: async (key) => {
        heads.push(key)
        return key in bucket ? { size: bucket[key] } : null
      },
      put: async (key, body) => {
        puts.push(key)
        bucket[key] = body.byteLength
      },
    },
    leerPdf: async (archivo) => PDFS[archivo],
  }
  return { fichas: fichas as Record<string, FichaTecnicaOverlay>, bucket, puts, heads, deps }
}

async function planDe(): Promise<PlanFichasR2> {
  return planificarFichas(T, indice.slice(0, 3), { hashear })
}

const viejas = (): Record<string, FichaTecnicaOverlay> => ({
  "1": { key: "productos/t/1/ficha-x1.pdf", nombre: "uno.pdf", bytes: PDFS["a.pdf"].byteLength },
  "2": { key: "productos/t/2/ficha-x2.pdf", nombre: "dos.pdf", bytes: PDFS["a.pdf"].byteLength },
  "3": { key: "productos/t/3/ficha-x3.pdf", nombre: "tres.pdf", bytes: PDFS["b.pdf"].byteLength },
  "4": { key: "productos/t/4/ficha-x4.pdf", nombre: "cuatro.pdf", bytes: PDFS["c.pdf"].byteLength },
})

describe("aplicarPlan", () => {
  it("dry-run: no sube ni escribe, pero cuenta qué haría", async () => {
    const f = fake(viejas())
    const r = await aplicarPlan(await planDe(), { ejecutar: false }, f.deps)

    expect(f.puts).toEqual([])
    expect(f.fichas["1"].key).toBe("productos/t/1/ficha-x1.pdf")
    expect(r).toMatchObject({ ejecutado: false, aActualizar: 4, actualizados: 0, objetosPorSubir: 2 })
  })

  it("--ejecutar sube UNA vez cada objeto distinto y apunta a todos los productos a él", async () => {
    const f = fake(viejas())
    const plan = await planDe()
    const r = await aplicarPlan(plan, { ejecutar: true }, f.deps)

    expect(f.puts).toHaveLength(2)
    expect(r).toMatchObject({ actualizados: 4, objetosSubidos: 2, casFallido: 0 })
    const shaA = sha256Hex(PDFS["a.pdf"])
    for (const id of ["1", "2", "4"]) expect(f.fichas[id].key).toBe(`productos/${T}/fichas/${shaA}.pdf`)
    expect(f.fichas["3"].key).not.toBe(f.fichas["1"].key)
  })

  it("guarda sha256, conserva el nombre y deja la copia anterior como origen", async () => {
    const f = fake(viejas())
    await aplicarPlan(await planDe(), { ejecutar: true }, f.deps)
    expect(f.fichas["1"]).toEqual({
      key: `productos/${T}/fichas/${sha256Hex(PDFS["a.pdf"])}.pdf`,
      nombre: "uno.pdf",
      bytes: PDFS["a.pdf"].byteLength,
      sha256: sha256Hex(PDFS["a.pdf"]),
      origen: { key: "productos/t/1/ficha-x1.pdf", bytes: PDFS["a.pdf"].byteLength },
    })
  })

  it("hace HEAD antes de PUT: un objeto que ya está en el bucket no se vuelve a subir", async () => {
    const plan = await planDe()
    const f = fake(viejas(), { [plan.objetos[0].key]: plan.objetos[0].bytes })
    const r = await aplicarPlan(plan, { ejecutar: true }, f.deps)

    expect(f.puts).toEqual([plan.objetos[1].key])
    expect(r.objetosYaEnR2).toBe(1)
    expect(f.heads.length).toBeGreaterThanOrEqual(2)
  })

  it("segunda corrida: ya aplicados, sin subir ni cambiar nada", async () => {
    const f = fake(viejas())
    const plan = await planDe()
    await aplicarPlan(plan, { ejecutar: true }, f.deps)
    const puts = f.puts.length
    const r = await aplicarPlan(plan, { ejecutar: true }, f.deps)

    expect(r).toMatchObject({ yaAplicados: 4, actualizados: 0, objetosSubidos: 0 })
    expect(f.puts).toHaveLength(puts)
  })

  it("compare-and-swap: si la ficha cambió mientras tanto, no se pisa", async () => {
    const f = fake(viejas())
    const cas = f.deps.cambiarSiVigente
    f.deps.cambiarSiVigente = async (t, id, vigente, nueva) => {
      if (id === "3") f.fichas["3"] = { key: "productos/t/3/ficha-nuevo.pdf", nombre: "manual.pdf", bytes: 7 }
      return cas(t, id, vigente, nueva)
    }
    const r = await aplicarPlan(await planDe(), { ejecutar: true }, f.deps)

    expect(r.casFallido).toBe(1)
    expect(f.fichas["3"].key).toBe("productos/t/3/ficha-nuevo.pdf")
    expect(r.actualizados).toBe(3)
  })

  it("si la copia vigente pesa distinto que el índice, no toca el producto", async () => {
    const v = viejas()
    v["3"].bytes = 1
    const f = fake(v)
    const r = await aplicarPlan(await planDe(), { ejecutar: true }, f.deps)

    expect(r.cambioDesdeElIndice).toBe(1)
    expect(f.fichas["3"].key).toBe("productos/t/3/ficha-x3.pdf")
  })

  it("producto sin ficha: se saltea", async () => {
    const f = fake({ ...viejas(), "2": null })
    const r = await aplicarPlan(await planDe(), { ejecutar: true }, f.deps)
    expect(r.sinFicha).toBe(1)
    expect(r.actualizados).toBe(3)
  })

  it("--limite y --producto acotan el alcance", async () => {
    const f1 = fake(viejas())
    expect((await aplicarPlan(await planDe(), { ejecutar: true, limite: 1 }, f1.deps)).actualizados).toBe(1)

    const f2 = fake(viejas())
    const r = await aplicarPlan(await planDe(), { ejecutar: true, productos: ["3"] }, f2.deps)
    expect(r.actualizados).toBe(1)
    expect(f2.fichas["3"].sha256).toBeDefined()
    expect(f2.fichas["1"].sha256).toBeUndefined()
  })

  it("un archivo local que ya no coincide con el plan no se sube", async () => {
    const f = fake(viejas())
    f.deps.leerPdf = async () => enc("otra cosa")
    const r = await aplicarPlan(await planDe(), { ejecutar: true, productos: ["1"] }, f.deps)

    expect(f.puts).toEqual([])
    expect(r.errores).toHaveLength(1)
    expect(f.fichas["1"].key).toBe("productos/t/1/ficha-x1.pdf")
  })

  it("si el origen ya existía (re-aplicar sobre un contenido anterior) se conserva el original", async () => {
    const v = viejas()
    v["1"] = { ...v["1"], key: "productos/t/fichas/viejo.pdf", origen: { key: "productos/t/1/ficha-orig.pdf", bytes: 5 } }
    const f = fake(v)
    await aplicarPlan(await planDe(), { ejecutar: true, productos: ["1"] }, f.deps)
    expect(f.fichas["1"].origen).toEqual({ key: "productos/t/1/ficha-orig.pdf", bytes: 5 })
  })

  it("nunca borra nada: las deps ni siquiera exponen delete", async () => {
    const f = fake(viejas())
    expect(Object.keys(f.deps.r2!)).toEqual(["head", "put"])
  })
})

describe("revertirPlan", () => {
  it("vuelve cada producto a origen.key (sin sha256 ni origen) si el objeto existe", async () => {
    const f = fake(viejas())
    const plan = await planDe()
    await aplicarPlan(plan, { ejecutar: true }, f.deps)
    const original = "productos/t/1/ficha-x1.pdf"
    f.bucket[original] = PDFS["a.pdf"].byteLength

    const r = await revertirPlan(plan, { ejecutar: true, productos: ["1"] }, { ...f.deps, r2: f.deps.r2! })

    expect(r.revertidos).toBe(1)
    expect(f.fichas["1"]).toEqual({ key: original, nombre: "uno.pdf", bytes: PDFS["a.pdf"].byteLength })
  })

  it("si la copia original ya no está en el bucket, no revierte", async () => {
    const f = fake(viejas())
    const plan = await planDe()
    await aplicarPlan(plan, { ejecutar: true }, f.deps)
    const r = await revertirPlan(plan, { ejecutar: true }, { ...f.deps, r2: f.deps.r2! })
    expect(r.origenNoExiste).toBe(4)
    expect(f.fichas["1"].sha256).toBeDefined()
  })

  it("dry-run no cambia nada; producto sin origen se cuenta aparte", async () => {
    const f = fake(viejas())
    const plan = await planDe()
    const r = await revertirPlan(plan, { ejecutar: false }, { ...f.deps, r2: f.deps.r2! })
    expect(r.sinOrigen).toBe(4)
    expect(f.fichas["1"].key).toBe("productos/t/1/ficha-x1.pdf")
  })
})

describe("calcularRespaldosSinUso", () => {
  it("lista las copias viejas que ningún producto usa como ficha vigente, sin duplicar", () => {
    const fichas = [
      { alegraId: "1", ficha: { key: "k/nuevo", nombre: "a", bytes: 9, origen: { key: "k/viejo1", bytes: 9 } } },
      { alegraId: "2", ficha: { key: "k/nuevo", nombre: "b", bytes: 9, origen: { key: "k/viejo2", bytes: 9 } } },
      // origen que otro producto sigue usando como ficha vigente: NO es candidato
      { alegraId: "3", ficha: { key: "k/viejo2", nombre: "c", bytes: 9 } },
      { alegraId: "4", ficha: { key: "k/sin-origen", nombre: "d", bytes: 9 } },
    ]
    expect(calcularRespaldosSinUso(fichas)).toEqual([{ key: "k/viejo1", bytes: 9, productos: 1 }])
  })
})
