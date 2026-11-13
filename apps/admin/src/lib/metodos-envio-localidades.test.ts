import { describe, it, expect, vi } from "vitest"
import { completarLocalidad, completarLocalidades } from "./metodos-envio-localidades"

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } })

const GEOREF = {
  localidades: [{ id: "9990001", nombre: "Ciudad Ejemplo", provincia: { nombre: "Buenos Aires" }, centroide: { lat: -38.0, lon: -57.5 } }],
}
const NOMINATIM = [{ boundingbox: ["-38.1", "-37.9", "-57.7", "-57.3"] }]

/** fetch falso: responde según el host de la URL. */
function fakeFetch(georef: () => Response, nominatim: () => Response) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes("apis.datos.gob.ar")) return georef()
    if (u.includes("nominatim")) return nominatim()
    throw new Error(`URL inesperada ${u}`)
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

describe("completarLocalidad", () => {
  it("centro de Georef y rectángulo de Nominatim", async () => {
    const f = fakeFetch(() => json(GEOREF), () => json(NOMINATIM))
    const r = await completarLocalidad("9990001", f)
    expect(r).toEqual({ centro: { lat: -38, lon: -57.5 }, bbox: { sur: -38.1, norte: -37.9, oeste: -57.7, este: -57.3 } })
    const urlGeoref = new URL(String((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]))
    expect(urlGeoref.searchParams.get("id")).toBe("9990001")
    expect(urlGeoref.searchParams.get("campos")).toContain("centroide.lat")
  })

  it("la consulta a Nominatim es acotada a la localidad y se identifica", async () => {
    const f = fakeFetch(() => json(GEOREF), () => json(NOMINATIM))
    await completarLocalidad("9990001", f)
    const llamada = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).includes("nominatim"))!
    const u = new URL(String(llamada[0]))
    expect(u.searchParams.get("city")).toBe("Ciudad Ejemplo")
    expect(u.searchParams.get("state")).toBe("Buenos Aires")
    expect(u.searchParams.get("countrycodes")).toBe("ar")
    expect((llamada[1] as RequestInit).headers).toHaveProperty("User-Agent")
  })

  it("Nominatim caído: queda el centro y el rectángulo en null (best-effort)", async () => {
    const f = fakeFetch(() => json(GEOREF), () => json({}, 503))
    expect(await completarLocalidad("9990001", f)).toEqual({ centro: { lat: -38, lon: -57.5 }, bbox: null })
  })

  it("Georef caído: todo en null y no tira", async () => {
    const f = fakeFetch(() => json({}, 500), () => json(NOMINATIM))
    expect(await completarLocalidad("9990001", f)).toEqual({ centro: null, bbox: null })
  })

  it("Georef sin centroide: usa el centro del rectángulo de Nominatim", async () => {
    const sinCentroide = { localidades: [{ id: "9990001", nombre: "Ciudad Ejemplo", provincia: { nombre: "Buenos Aires" } }] }
    const f = fakeFetch(() => json(sinCentroide), () => json(NOMINATIM))
    const r = await completarLocalidad("9990001", f)
    expect(r.centro).toEqual({ lat: -38, lon: -57.5 })
    expect(r.bbox).not.toBeNull()
  })

  it("descarta coordenadas fuera de Argentina", async () => {
    const f = fakeFetch(() => json(GEOREF), () => json([{ boundingbox: ["10", "11", "10", "11"] }]))
    expect((await completarLocalidad("9990001", f)).bbox).toBeNull()
  })

  it("respuesta con forma inesperada no tira", async () => {
    const f = fakeFetch(() => json({ cualquier: "cosa" }), () => json("texto"))
    expect(await completarLocalidad("9990001", f)).toEqual({ centro: null, bbox: null })
  })
})

describe("completarLocalidades", () => {
  it("completa cada una y conserva el resto de los campos", async () => {
    const f = fakeFetch(() => json(GEOREF), () => json(NOMINATIM))
    const r = await completarLocalidades([{ georefId: "9990001", etiqueta: "Ciudad Ejemplo — Buenos Aires", abreviaturas: ["ce"] }], f)
    expect(r).toEqual([
      {
        georefId: "9990001",
        etiqueta: "Ciudad Ejemplo — Buenos Aires",
        abreviaturas: ["ce"],
        centro: { lat: -38, lon: -57.5 },
        bbox: { sur: -38.1, norte: -37.9, oeste: -57.7, este: -57.3 },
      },
    ])
  })
})
