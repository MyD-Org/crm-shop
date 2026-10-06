import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { CLAVES_ATRIBUTO, CURVAS, DEFINICION_ATRIBUTOS, extraerAtributosDeNombre } from "./catalogo-atributos-extraccion"

/**
 * Paridad entre el extractor del CRM (nombre de producto → `catalog_atributos`) y el parser de medidas
 * del buscador del Shop (consulta → medidas). El contrato es UN fixture que vive en el Shop
 * (`apps/clientes/src/db/__fixtures__/medidas-dorados.json`) y lo leen los dos tests. Acá no hay código
 * de producción nuevo: solo se comprueba que el vocabulario y los casos "explícitos" coinciden.
 *
 * Si el fixture no está (build de Vercel con Root Directory por app) el test se salta, igual que la
 * paridad de claves (`catalogo-atributos-claves.test.ts`).
 */
const FIXTURE = fileURLToPath(new URL("../../../clientes/src/db/__fixtures__/medidas-dorados.json", import.meta.url))

interface MedidaFixture {
  clave: string
  op: "eq" | "lte" | "gte" | "entre"
  valor?: number | string
  min?: number
  max?: number
}
interface Fixture {
  vocabulario: {
    claves: string[]
    rangos: Record<string, [number, number]>
    enteros: string[]
    zocalos: string[]
    curvas: string[]
    serie_iec: number[]
    notas: Record<string, string>
  }
  casos: { id: string; consulta: string; esperado: MedidaFixture[]; paridad: boolean; nota?: string }[]
}

const hayFixture = existsSync(FIXTURE)
const fixture = (hayFixture ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null) as Fixture

/** Lo que extrae el admin de una consulta, limitado a las claves que el buscador sabe leer. */
const delAdmin = (consulta: string) =>
  extraerAtributosDeNombre(consulta).filter((a) => fixture.vocabulario.claves.includes(a.clave))
const valorDe = (a: { valorNum: number | null; valorTexto: string | null }) => a.valorNum ?? a.valorTexto

describe.skipIf(!hayFixture)("paridad del parser de medidas del Shop con el extractor del CRM", () => {
  it("las claves del fixture son claves de catalog_atributos", () => {
    for (const c of fixture.vocabulario.claves) expect(CLAVES_ATRIBUTO as readonly string[], c).toContain(c)
  })

  it("rangos: iguales a DEFINICION_ATRIBUTOS (ip: el Shop acepta 10-69 y lo declara en las notas)", () => {
    for (const [clave, rango] of Object.entries(fixture.vocabulario.rangos)) {
      const admin = DEFINICION_ATRIBUTOS[clave as keyof typeof DEFINICION_ATRIBUTOS].rango
      expect(admin, clave).toBeDefined()
      if (clave === "ip") {
        expect(rango[0]).toBeGreaterThanOrEqual(admin![0])
        expect(rango[1]).toBeLessThanOrEqual(admin![1])
        expect(fixture.vocabulario.notas.ip).toBeTruthy()
      } else {
        expect(rango, clave).toEqual(admin)
      }
    }
  })

  it("enteros: los que el admin declara enteros (más ip, que el Shop lee como entero)", () => {
    const adminEnteros = CLAVES_ATRIBUTO.filter((c) => DEFINICION_ATRIBUTOS[c].entero && fixture.vocabulario.claves.includes(c))
    expect([...fixture.vocabulario.enteros].sort()).toEqual([...adminEnteros, "ip"].sort())
  })

  it("curvas == CURVAS", () => {
    expect(fixture.vocabulario.curvas).toEqual([...CURVAS])
  })

  it("zócalos: el admin reconoce exactamente los del fixture dentro de un universo de prueba", () => {
    const universo = [
      ...fixture.vocabulario.zocalos,
      "e5", "e11", "e26", "e30", "gu4", "gu24", "mr8", "mr20", "gx16", "g5", "g23", "g53", "b22", "b15", "r7", "t5",
    ]
    const reconocidos = universo.filter((z) => extraerAtributosDeNombre(`lampara ${z}`).some((a) => a.clave === "zocalo" && a.valorTexto === z))
    expect(new Set(reconocidos)).toEqual(new Set(fixture.vocabulario.zocalos))
  })

  it("serie IEC: el admin acepta 'curva + corriente' solo para la serie del fixture", () => {
    const aceptadas = Array.from({ length: 130 }, (_, i) => i + 1).filter((n) =>
      extraerAtributosDeNombre(`termica c${n}`).some((a) => a.clave === "corriente_a" && a.valorNum === n),
    )
    expect(aceptadas).toEqual(fixture.vocabulario.serie_iec)
  })

  it("todo caso sin paridad tiene una nota que explica la divergencia", () => {
    for (const c of fixture.casos.filter((x) => !x.paridad)) expect(c.nota?.trim(), c.id).toBeTruthy()
  })

  describe("casos con paridad=true", () => {
    const casos = hayFixture ? fixture.casos.filter((c) => c.paridad) : []

    it("hay casos de paridad", () => {
      expect(casos.length).toBeGreaterThan(20)
    })

    for (const c of casos) {
      it(`${c.id}: "${c.consulta}"`, () => {
        const admin = delAdmin(c.consulta)
        if (c.esperado.length === 0) {
          // Negativo: el admin tampoco extrae ninguna de las claves del buscador.
          expect(admin.map((a) => `${a.clave}=${valorDe(a)}`)).toEqual([])
          return
        }
        for (const m of c.esperado) {
          expect(m.op, `${c.id} ${m.clave}: la paridad solo cubre valores exactos`).toBe("eq")
          expect(admin.some((a) => a.clave === m.clave && valorDe(a) === m.valor), `${c.id} ${m.clave}=${m.valor}`).toBe(true)
        }
      })
    }
  })
})
