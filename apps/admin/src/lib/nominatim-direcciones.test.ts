import { describe, it, expect } from "vitest"
import { consultasNominatim, sugerenciasDeNominatim } from "./nominatim-direcciones"

describe("consultasNominatim", () => {
  it("con ciudad y provincia: consulta ESTRUCTURADA con el número al frente, y un reintento por q", () => {
    const [primera, reintento] = consultasNominatim("Av. Colón 2500", "Mar del Plata", "Buenos Aires")
    expect(primera.searchParams.get("street")).toBe("2500 av. colón")
    expect(primera.searchParams.get("city")).toBe("mar del plata")
    expect(primera.searchParams.get("state")).toBe("buenos aires")
    expect(primera.searchParams.get("countrycodes")).toBe("ar")
    expect(primera.searchParams.get("q")).toBeNull()
    expect(reintento.searchParams.get("q")).toBe("av. colón 2500, mar del plata, buenos aires")
    expect(reintento.searchParams.get("street")).toBeNull()
  })

  it("sin número deja la calle como viene", () => {
    const [primera] = consultasNominatim("Parque Hermoso", "Mar del Plata", "Buenos Aires")
    expect(primera.searchParams.get("street")).toBe("parque hermoso")
  })

  it("sin ciudad: una sola consulta libre acotada a Argentina (sin reintento)", () => {
    const consultas = consultasNominatim("Av. Colón 2500", null, null)
    expect(consultas).toHaveLength(1)
    expect(consultas[0].searchParams.get("q")).toBe("av. colón 2500")
    expect(consultas[0].searchParams.get("countrycodes")).toBe("ar")
  })

  it("pide el detalle de dirección y pocos resultados", () => {
    const [u] = consultasNominatim("Av. Colón 2500", "Mar del Plata", "Buenos Aires")
    expect(u.searchParams.get("addressdetails")).toBe("1")
    expect(Number(u.searchParams.get("limit"))).toBeLessThanOrEqual(6)
    expect(u.origin).toBe("https://nominatim.openstreetmap.org")
  })

  it("minúsculas: así 'Colón' y 'colón' comparten la caché por URL", () => {
    const a = consultasNominatim("AV. COLÓN 2500", "MAR DEL PLATA", "BUENOS AIRES")[0].toString()
    const b = consultasNominatim("av. colón 2500", "mar del plata", "buenos aires")[0].toString()
    expect(a).toBe(b)
  })
})

describe("sugerenciasDeNominatim", () => {
  const crudo = [
    {
      lat: "-38.0016",
      lon: "-57.5522",
      address: { road: "Avenida Colón", house_number: "2500", city: "Municipio de Ciudad Ejemplo", postcode: "7600", state: "Provincia de Buenos Aires" },
    },
    { lat: "-38.01", lon: "-57.55", address: { road: "Avenida Colón", town: "Ciudad Ejemplo", state: "Buenos Aires" } },
    { lat: "x", lon: "-57.5", address: { road: "Rota" } },
    { lat: "10", lon: "10", address: { road: "Fuera de Argentina" } },
  ]
  it("arma etiqueta, coordenadas y precisión (altura sólo con house_number)", () => {
    const s = sugerenciasDeNominatim(crudo)
    expect(s).toHaveLength(2)
    expect(s[0]).toEqual({
      label: "Avenida Colón 2500, Ciudad Ejemplo, Buenos Aires",
      calle: "Avenida Colón 2500",
      ciudad: "Ciudad Ejemplo",
      provincia: "Buenos Aires",
      cp: "7600",
      lat: -38.0016,
      lon: -57.5522,
      precision: "altura",
    })
    expect(s[1].precision).toBe("calle")
  })
  it("una respuesta que no es un arreglo da vacío", () => {
    expect(sugerenciasDeNominatim({})).toEqual([])
    expect(sugerenciasDeNominatim(null)).toEqual([])
  })
})
