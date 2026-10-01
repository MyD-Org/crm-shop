import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  aplicarAceptados,
  formatearResumenAplicar,
  formatearResumenVerificacion,
  parsearAceptado,
  parsearLecturaCruda,
  verificarDirectorio,
  type DepsAplicar,
  type ExistenteAtributo,
} from "./catalogo-atributos-lectura-local"
import { crearPdfDePrueba, crearPdfPosicionado, type TextoPosicionado } from "./pdf-de-prueba"

// Todo ficticio.
const RELLENO = "Descripcion general del producto con caracteristicas tecnicas y condiciones de uso del equipo."

let dir: string

async function escribirPdf(rel: string, paginas: string[][]) {
  const abs = path.join(dir, rel)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, await crearPdfDePrueba(paginas))
}

async function escribirPdfPosicionado(rel: string, paginas: TextoPosicionado[][]) {
  const abs = path.join(dir, rel)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, await crearPdfPosicionado(paginas))
}

/** Tabla transpuesta: modelos como encabezados de columna, rótulos a la izquierda. */
const tabla = (...columnas: { modelo: string; potencia: string; flujo: string; ip: string }[]): TextoPosicionado[] => [
  { t: RELLENO, x: 40, y: 800 },
  { t: "Modelo", x: 40, y: 720 }, { t: "Potencia", x: 40, y: 700 }, { t: "Flujo", x: 40, y: 680 }, { t: "IP", x: 40, y: 660 },
  ...columnas.flatMap((c, i) => [
    { t: c.modelo, x: 150 + i * 100, y: 720 }, { t: c.potencia, x: 150 + i * 100, y: 700 },
    { t: c.flujo, x: 150 + i * 100, y: 680 }, { t: c.ip, x: 150 + i * 100, y: 660 },
  ]),
]

const jsonl = (xs: unknown[]) => xs.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n")
const leerJsonl = async (rel: string) =>
  (await readFile(path.join(dir, rel), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "atributos-pdf-"))
  await mkdir(path.join(dir, "lectura", "crudo"), { recursive: true })
  await writeFile(
    path.join(dir, "indice.json"),
    JSON.stringify([
      {
        archivo: "reflectores.pdf",
        bytes: 1,
        productos: [
          { id: "10", code: "RF-10-XYZ", nombre: "REFLECTOR 10W", marca: "Ejemplo" },
          { id: "20", code: "RF-20-XYZ", nombre: "REFLECTOR 20W", marca: "Ejemplo" },
          { id: "30", code: "RF-30-XYZ", nombre: "REFLECTOR 30W", marca: "Ejemplo" },
        ],
      },
      { archivo: "termica.pdf", bytes: 1, productos: [{ id: "40", code: "TM-0025-XYZ", nombre: "TERMICA 2X25A", marca: "Ejemplo" }] },
      { archivo: "escaneado.pdf", bytes: 1, productos: [{ id: "50", code: "ESC-0001-XYZ", nombre: "CAJA", marca: "Ejemplo" }] },
    ]),
  )
  await escribirPdfPosicionado("pdfs/reflectores.pdf", [
    tabla(
      { modelo: "RF-10", potencia: "10W", flujo: "800LM", ip: "65" },
      { modelo: "RF-20", potencia: "20W", flujo: "1600LM", ip: "65" },
      { modelo: "RF-30", potencia: "30W", flujo: "2400LM", ip: "66" },
    ),
  ])
  await escribirPdf("pdfs/termica.pdf", [[RELLENO, "Termica bipolar 2P 25A poder de corte 6kA curva C"]])
  await escribirPdf("pdfs/escaneado.pdf", [[], []])
  await escribirPdfPosicionado("recortes/reflector-20.pdf", [tabla({ modelo: "RF-20", potencia: "20W", flujo: "1600LM", ip: "65" })])
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("verificarDirectorio", () => {
  it("acepta lo verificado y descarta el resto con motivo (incluido el reflector de 20W con la fila de 10W)", async () => {
    await writeFile(
      path.join(dir, "lectura", "crudo", "lote-1.jsonl"),
      jsonl([
        // El caso que motivó las reglas: producto 20W, el modelo devuelve la fila de 10W.
        { id: "20", pdf: "pdfs/reflectores.pdf", fila: "RF-10", atributos: { potencia_w: { valor: 10, cita: "RF-10 10W 800LM IP65" }, flujo_lm: { valor: 800, cita: "RF-10 10W 800LM IP65" } } },
        // La fila correcta.
        { id: "30", pdf: "pdfs/reflectores.pdf", fila: "RF-30", atributos: { flujo_lm: { valor: 2400 }, ip: { valor: 66, cita: "IP 66" } } },
        // Ficha individual: fila null.
        { id: "40", pdf: "pdfs/termica.pdf", fila: null, atributos: { poder_corte_ka: { valor: 6, cita: "poder de corte 6kA" }, curva: { valor: "c", cita: "curva C" } } },
        // Recorte con fila null: no es ficha de un solo producto.
        { id: "20", pdf: "recortes/reflector-20.pdf", fila: null, atributos: { flujo_lm: { valor: 1600, cita: "RF-20 20W 1600LM" } } },
        // PDF escaneado.
        { id: "50", pdf: "pdfs/escaneado.pdf", fila: null, atributos: { color: { valor: "negro", cita: "negro" } } },
      ]),
    )
    const r = await verificarDirectorio(dir)

    const aceptados = await leerJsonl("lectura/aceptados.jsonl")
    expect(aceptados.map((a) => `${a.id}:${a.clave}`).sort()).toEqual(["30:flujo_lm", "30:ip", "40:curva", "40:poder_corte_ka"])
    expect(aceptados.find((a) => a.id === "30" && a.clave === "flujo_lm")).toMatchObject({
      valorNum: 2400,
      cita: null,
      regla: "fila",
      evidencia: "2400LM",
      fila: "RF-30",
      pdf: "pdfs/reflectores.pdf",
    })

    const descartes = await leerJsonl("lectura/descartes.jsonl")
    expect(descartes.map((d) => `${d.id}:${d.clave}:${d.motivo}`).sort()).toEqual([
      "20:flujo_lm:fila_ausente",
      "20:flujo_lm:fila_no_coincide",
      "20:potencia_w:fila_no_coincide",
      "50:color:sin_texto",
    ])
    expect(r.porMotivo).toEqual({ fila_no_coincide: 2, fila_ausente: 1, sin_texto: 1 })
    expect(r.porClave.flujo_lm).toEqual({ aceptados: 1, descartados: 2 })
    expect(formatearResumenVerificacion(r)).toContain("fila_no_coincide: 2")
  })

  it("trata el crudo como dato no confiable: forma, id, ruta y archivo", async () => {
    await writeFile(
      path.join(dir, "lectura", "crudo", "lote-2.jsonl"),
      jsonl([
        "esto no es json",
        { id: "20" },
        { id: "999", pdf: "pdfs/reflectores.pdf", fila: "RF-20", atributos: { ip: { valor: 65, cita: "IP65" } } },
        { id: "20", pdf: "../../etc/pasaporte.pdf", fila: "RF-20", atributos: { ip: { valor: 65, cita: "IP65" } } },
        { id: "20", pdf: "pdfs/no-existe.pdf", fila: "RF-20", atributos: { ip: { valor: 65, cita: "IP65" } } },
        { id: "20", pdf: "pdfs/reflectores.pdf", fila: "RF-20", atributos: { inventada: { valor: 1, cita: "RF-20" } } },
      ]),
    )
    await writeFile(path.join(dir, "pdfs", "roto.pdf"), "no es un pdf")
    await writeFile(
      path.join(dir, "lectura", "crudo", "lote-3.jsonl"),
      jsonl([{ id: "20", pdf: "pdfs/roto.pdf", fila: "RF-20", atributos: { ip: { valor: 65, cita: "IP65" } } }]),
    )
    const r = await verificarDirectorio(dir)
    expect(await leerJsonl("lectura/aceptados.jsonl")).toEqual([])
    expect(r.porMotivo).toEqual({
      linea_invalida: 2,
      producto_desconocido: 1,
      pdf_fuera_del_directorio: 1,
      pdf_inexistente: 1,
      clave_desconocida: 1,
      pdf_ilegible: 1,
    })
  })

  it("dos lecturas que se contradicen no cargan nada; si coinciden queda una", async () => {
    await writeFile(
      path.join(dir, "lectura", "crudo", "a.jsonl"),
      jsonl([{ id: "30", pdf: "pdfs/reflectores.pdf", fila: "RF-30", atributos: { flujo_lm: { valor: 2400, cita: "RF-30 30W 2400LM" }, ip: { valor: 66, cita: "RF-30 30W 2400LM IP66" } } }]),
    )
    await writeFile(
      path.join(dir, "lectura", "crudo", "b.jsonl"),
      jsonl([
        { id: "30", pdf: "pdfs/reflectores.pdf", fila: "RF-30", atributos: { flujo_lm: { valor: 800, cita: "RF-10 10W 800LM" }, ip: { valor: 66, cita: "RF-30 30W 2400LM IP66" } } },
      ]),
    )
    const r = await verificarDirectorio(dir)
    const aceptados = await leerJsonl("lectura/aceptados.jsonl")
    // 800 LM sale de la fila de 10W (otra columna): se descarta; el 2400 queda. ip: dos citas, mismo valor.
    expect(aceptados.map((a) => `${a.id}:${a.clave}:${a.valorNum}`).sort()).toEqual(["30:flujo_lm:2400", "30:ip:66"])
    expect(r.porMotivo.valor_fuera_de_fila).toBe(1)
  })
})

describe("parsearLecturaCruda / parsearAceptado", () => {
  it("normaliza la forma y rechaza lo malformado", () => {
    expect(parsearLecturaCruda('{"id":"1","pdf":"pdfs/a.pdf","atributos":{"ip":{"valor":65,"cita":"IP65"}}}')).toEqual({
      id: "1",
      pdf: "pdfs/a.pdf",
      fila: null,
      atributos: { ip: { valor: 65, cita: "IP65" } },
    })
    expect(parsearLecturaCruda('{"id":1,"pdf":"x","atributos":{}}')).toBeNull()
    expect(parsearLecturaCruda('{"id":"1","pdf":"x","fila":3,"atributos":{}}')).toBeNull()
    expect(parsearLecturaCruda('{"id":"1","pdf":"x","atributos":{"ip":5}}')).toBeNull()
  })

  it("el aceptado se vuelve a validar con rangos y vocabularios", () => {
    expect(parsearAceptado('{"id":"1","clave":"polos","valorNum":2,"valorTexto":null}')?.atributo).toMatchObject({ clave: "polos", valorNum: 2 })
    expect(parsearAceptado('{"id":"1","clave":"polos","valorNum":9,"valorTexto":null}')).toBeNull()
    expect(parsearAceptado('{"id":"1","clave":"color","valorNum":null,"valorTexto":"fucsia"}')).toBeNull()
    expect(parsearAceptado('{"id":"1","clave":"inventada","valorNum":1,"valorTexto":null}')).toBeNull()
    expect(parsearAceptado('{"id":"1","clave":"tension_v","valorNum":175,"valorTexto":"85-265"}')?.atributo.valorTexto).toBe("85-265")
  })
})

describe("aplicarAceptados", () => {
  const linea = (id: string, clave: string, valorNum: number | null, valorTexto: string | null = null) =>
    JSON.stringify({ id, clave, valorNum, valorTexto, cita: "x", fila: null, pdf: "pdfs/a.pdf" })

  function deps(existentes: Record<string, ExistenteAtributo> = {}): DepsAplicar & { upsertPdf: ReturnType<typeof vi.fn> } {
    return {
      leerExistentes: vi.fn(async () => new Map(Object.entries(existentes))),
      upsertPdf: vi.fn(async (_t: string, filas: unknown[]) => filas.length),
    }
  }

  const contenido = [
    linea("1", "polos", 2),
    linea("1", "corriente_a", 25),
    linea("2", "polos", 3),
    linea("2", "color", null, "negro"),
    linea("3", "polos", 9), // fuera de rango: inválida
    "no es json",
  ].join("\n")

  it("dry-run: clasifica contra lo que hay y no escribe", async () => {
    const d = deps({
      "1|polos": { fuente: "nombre", valorNum: 2, valorTexto: null },
      "2|polos": { fuente: "manual", valorNum: 4, valorTexto: null },
      "2|color": { fuente: "pdf", valorNum: null, valorTexto: "gris" },
    })
    const r = await aplicarAceptados(contenido, "central", d, false)
    expect(d.upsertPdf).not.toHaveBeenCalled()
    expect(r).toMatchObject({ lineas: 6, invalidas: 2, nuevas: 1, confirmanNombre: 1, protegidasManual: 1, cambian: 1, iguales: 0, escritas: null })
    expect(formatearResumenAplicar(r, false)).toContain("dry-run")
  })

  it("--aplicar: upsert con fuente pdf (la precedencia la resuelve el SQL del upsert)", async () => {
    const d = deps()
    const r = await aplicarAceptados(contenido, "central", d, true)
    expect(d.upsertPdf).toHaveBeenCalledTimes(1)
    const [tenant, filas] = d.upsertPdf.mock.calls[0]
    expect(tenant).toBe("central")
    expect(filas).toHaveLength(4)
    expect(r.escritas).toBe(4)
  })

  it("dos valores distintos del mismo (producto, clave) en el archivo: no se carga ninguno", async () => {
    const d = deps()
    const r = await aplicarAceptados([linea("1", "polos", 2), linea("1", "polos", 3), linea("1", "corriente_a", 10)].join("\n"), "t", d, true)
    expect(r.conflictos).toBe(1)
    expect(d.upsertPdf.mock.calls[0][1]).toEqual([{ alegraId: "1", clave: "corriente_a", valorNum: 10, valorTexto: null }])
  })

  it("sin nada válido no llama al upsert", async () => {
    const d = deps()
    const r = await aplicarAceptados("basura", "t", d, true)
    expect(d.upsertPdf).not.toHaveBeenCalled()
    expect(r.escritas).toBe(0)
  })
})
