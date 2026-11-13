import { describe, it, expect } from "vitest"
import {
  COLORES_ZONA,
  colorDeZona,
  geojsonAGeometria,
  geometriaAGeojson,
  geometriaALatLngs,
  latLngsAGeometria,
  vistaInicial,
} from "./mapa-zonas"
import type { Geometria } from "./geo-poligono"

const cuadrado: Geometria = [[[[-57.6, -38.05], [-57.5, -38.05], [-57.5, -37.95], [-57.6, -37.95], [-57.6, -38.05]]]]
const conHueco: Geometria = [
  [
    [[-57.6, -38.05], [-57.5, -38.05], [-57.5, -37.95], [-57.6, -37.95], [-57.6, -38.05]],
    [[-57.56, -38.01], [-57.54, -38.01], [-57.54, -37.99], [-57.56, -37.99], [-57.56, -38.01]],
  ],
]

describe("GeoJSON [lon, lat] ↔ Leaflet [lat, lng]", () => {
  it("geometriaALatLngs invierte el orden y quita el punto de cierre", () => {
    expect(geometriaALatLngs(cuadrado)).toEqual([[[[-38.05, -57.6], [-38.05, -57.5], [-37.95, -57.5], [-37.95, -57.6]]]])
  })

  it("latLngsAGeometria vuelve a cerrar los anillos y respeta los huecos", () => {
    const capa = [
      [{ lat: -38.05, lng: -57.6 }, { lat: -38.05, lng: -57.5 }, { lat: -37.95, lng: -57.5 }, { lat: -37.95, lng: -57.6 }],
      [{ lat: -38.01, lng: -57.56 }, { lat: -38.01, lng: -57.54 }, { lat: -37.99, lng: -57.54 }, { lat: -37.99, lng: -57.56 }],
    ]
    expect(latLngsAGeometria([capa])).toEqual(conHueco)
  })

  it("ida y vuelta sin pérdida", () => {
    const aLeaflet = geometriaALatLngs(conHueco).map((poligono) => poligono.map((anillo) => anillo.map(([lat, lng]) => ({ lat, lng }))))
    expect(latLngsAGeometria(aLeaflet)).toEqual(conHueco)
  })

  it("una capa simple (sólo anillos) cuenta como un polígono, y una multi como varios", () => {
    const anillo = [{ lat: -38.05, lng: -57.6 }, { lat: -38.05, lng: -57.5 }, { lat: -37.95, lng: -57.5 }]
    expect(latLngsAGeometria([anillo])).toHaveLength(1)
    expect(latLngsAGeometria([[anillo], [anillo]])).toHaveLength(2)
  })

  it("descarta capas vacías o con menos de 3 puntos", () => {
    expect(latLngsAGeometria([[], [[{ lat: 1, lng: 1 }]]])).toEqual([])
  })
})

describe("importar y exportar GeoJSON", () => {
  it("exporta un MultiPolygon", () => {
    expect(geometriaAGeojson(conHueco, "Centro")).toEqual({
      type: "Feature",
      properties: { nombre: "Centro" },
      geometry: { type: "MultiPolygon", coordinates: conHueco },
    })
  })

  it("importa Polygon, MultiPolygon, Feature y FeatureCollection", () => {
    const poligono = { type: "Polygon", coordinates: cuadrado[0] }
    expect(geojsonAGeometria(poligono)).toEqual({ ok: true, g: cuadrado })
    expect(geojsonAGeometria({ type: "MultiPolygon", coordinates: cuadrado })).toEqual({ ok: true, g: cuadrado })
    expect(geojsonAGeometria({ type: "Feature", geometry: poligono })).toEqual({ ok: true, g: cuadrado })
    const dos = geojsonAGeometria({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: poligono }, { type: "Feature", geometry: { type: "MultiPolygon", coordinates: cuadrado } }],
    })
    expect(dos.ok && dos.g).toHaveLength(2)
  })

  it("acepta texto JSON", () => {
    expect(geojsonAGeometria(JSON.stringify({ type: "Polygon", coordinates: cuadrado[0] }))).toEqual({ ok: true, g: cuadrado })
  })

  it("rechaza en usted lo que no es un polígono o no es válido", () => {
    for (const malo of ["no es json", { type: "Point", coordinates: [1, 2] }, { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, null, { type: "FeatureCollection", features: [] }]) {
      const r = geojsonAGeometria(malo)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).not.toMatch(/\b(tu|vos)\b/i)
    }
  })
})

describe("presentación", () => {
  it("colorDeZona rota por la paleta", () => {
    expect(colorDeZona(0)).toBe(COLORES_ZONA[0])
    expect(colorDeZona(COLORES_ZONA.length)).toBe(COLORES_ZONA[0])
    expect(colorDeZona(-1)).toBe(COLORES_ZONA[COLORES_ZONA.length - 1])
  })

  it("vistaInicial centra en lo dibujado y cae a Argentina si no hay nada", () => {
    expect(vistaInicial([cuadrado])).toMatchObject({ centro: [-38, -57.55] })
    expect(vistaInicial([[], []])).toMatchObject({ centro: expect.any(Array), zoom: 4 })
  })
})
