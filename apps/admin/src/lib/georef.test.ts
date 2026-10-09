import { describe, expect, it } from "vitest"
import { buscarLocalidades, etiquetaLocalidad, GeorefError, normalizarBusqueda } from "./georef"

const loc = (id: string, nombre: string, provincia: string, departamento?: string, categoria?: string) => ({
  id,
  nombre,
  categoria,
  provincia: { nombre: provincia },
  departamento: departamento ? { nombre: departamento } : undefined,
})

const conCuerpo = (cuerpo: string, status = 200) => (async () => new Response(cuerpo, { status })) as unknown as typeof fetch
const respuesta = (localidades: unknown[]) => conCuerpo(JSON.stringify({ localidades }))

describe("georef (admin)", () => {
  it("normaliza sin tildes ni mayúsculas", () => {
    expect(normalizarBusqueda("  Córdoba  Capital ")).toBe("cordoba capital")
  })

  it("con menos de 4 letras no llama a Georef", async () => {
    let llamadas = 0
    const f = (async () => {
      llamadas++
      return new Response("{}")
    }) as unknown as typeof fetch
    expect(await buscarLocalidades("Mar", f)).toEqual([])
    expect(llamadas).toBe(0)
  })

  it("parsea, descarta filas inválidas y depura 'Entidad' repetida", async () => {
    const f = respuesta([
      loc("1", "Mar del Plata", "Buenos Aires", "General Pueyrredón", "Entidad"),
      loc("2", "Mar del Plata", "Buenos Aires", "General Pueyrredón", "Localidad simple"),
      { id: "x", nombre: "Rota" },
      null,
    ])
    const r = await buscarLocalidades("Mar del", f)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: "2", localidad: "Mar del Plata", provinciaNombre: "Buenos Aires" })
  })

  it("etiqueta con partido sólo si hay homónimas en la provincia", () => {
    const a = { id: "1", localidad: "San José", provinciaNombre: "Entre Ríos", partido: "Colón" }
    const b = { id: "2", localidad: "San José", provinciaNombre: "Entre Ríos", partido: "Federación" }
    expect(etiquetaLocalidad(a, [a, b])).toBe("San José (Colón) — Entre Ríos")
    expect(etiquetaLocalidad(a, [a])).toBe("San José — Entre Ríos")
  })

  it("falla con GeorefError ante 5xx, red caída o JSON sin 'localidades'", async () => {
    const fRed = (async () => {
      throw new Error("red")
    }) as unknown as typeof fetch
    await expect(buscarLocalidades("Posadas", conCuerpo("", 503))).rejects.toMatchObject({ motivo: "upstream" })
    await expect(buscarLocalidades("Posadas", fRed)).rejects.toBeInstanceOf(GeorefError)
    await expect(buscarLocalidades("Posadas", conCuerpo("{}"))).rejects.toMatchObject({ motivo: "respuesta" })
    await expect(buscarLocalidades("Posadas", conCuerpo("no es json"))).rejects.toMatchObject({ motivo: "respuesta" })
  })
})
