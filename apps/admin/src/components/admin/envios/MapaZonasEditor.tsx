"use client"

import { useEffect, useRef } from "react"
import * as L from "leaflet"
import "leaflet/dist/leaflet.css"
import "@geoman-io/leaflet-geoman-free"
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css"
import type { Geometria } from "@/lib/geo-poligono"
import { geometriaALatLngs, latLngsAGeometria, vistaInicial } from "@/lib/mapa-zonas"

// Mapa del editor de zonas (Leaflet + Geoman). SÓLO cliente: se carga con next/dynamic({ ssr: false })
// desde ZonasEnvioEditor. La zona activa se dibuja, edita y borra; las demás se ven en sólo lectura con
// su nombre. Los puntos se dibujan con circleMarker (sin íconos por defecto de Leaflet, que dependen
// de rutas de imágenes). Mosaicos de OpenStreetMap con su atribución (CSP: img-src en /admin/envios).

export interface ZonaMapa {
  clave: string
  nombre: string
  color: string
  activa: boolean
  geometria: Geometria
}

interface Props {
  zonas: ZonaMapa[]
  /** Zona que se edita en el mapa (null = sólo mirar). */
  zonaActiva: string | null
  onGeometria: (clave: string, g: Geometria) => void
  /** Punto de la "Prueba de dirección". */
  punto?: { lat: number; lon: number } | null
  /** Zona que se resalta (la resuelta por la prueba). */
  zonaResaltada?: string | null
}

const ATRIBUCION = "© OpenStreetMap contributors"
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"

export default function MapaZonasEditor({ zonas, zonaActiva, onGeometria, punto, zonaResaltada }: Props) {
  const contenedor = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const grupoActivo = useRef<L.FeatureGroup | null>(null)
  const grupoOtras = useRef<L.FeatureGroup | null>(null)
  const marcador = useRef<L.CircleMarker | null>(null)
  // Lo último que el mapa le informó al padre, para no reconstruir las capas (y salir del modo
  // edición) cada vez que el padre nos devuelve la misma geometría.
  const ultimaEmitida = useRef<string>("")
  const claveActiva = useRef<string | null>(null)
  const vistaAjustada = useRef(false)
  // Los handlers del mapa se crean una vez: leen siempre la última versión de las props.
  const cb = useRef({ onGeometria, zonaActiva, zonas })
  useEffect(() => {
    cb.current = { onGeometria, zonaActiva, zonas }
  })

  // ── Creación del mapa (una vez) ──
  useEffect(() => {
    if (!contenedor.current) return
    const vista = vistaInicial(cb.current.zonas.map((z) => z.geometria))
    const m = L.map(contenedor.current, { center: vista.centro, zoom: vista.zoom, zoomControl: true })
    L.tileLayer(TILES, { attribution: ATRIBUCION, maxZoom: 19 }).addTo(m)
    m.pm.setLang("es")
    mapa.current = m
    grupoOtras.current = L.featureGroup().addTo(m)
    grupoActivo.current = L.featureGroup().addTo(m)

    const emitir = () => {
      const clave = cb.current.zonaActiva
      const grupo = grupoActivo.current
      if (!clave || !grupo) return
      const capas: unknown[] = []
      grupo.eachLayer((l) => {
        if (l instanceof L.Polygon) capas.push(l.getLatLngs())
      })
      const g = latLngsAGeometria(capas)
      ultimaEmitida.current = JSON.stringify(g)
      cb.current.onGeometria(clave, g)
    }
    const enlazar = (capa: L.Layer) => {
      capa.on("pm:edit", emitir)
      capa.on("pm:cut", emitir)
    }
    ;(grupoActivo.current as L.FeatureGroup & { __enlazar?: (c: L.Layer) => void }).__enlazar = enlazar

    m.on("pm:create", (e: { layer: L.Layer }) => {
      const clave = cb.current.zonaActiva
      const z = cb.current.zonas.find((x) => x.clave === clave)
      if (!clave || !z || !grupoActivo.current) {
        m.removeLayer(e.layer)
        return
      }
      ;(e.layer as L.Path).setStyle({ color: z.color, fillColor: z.color, fillOpacity: 0.25, weight: 2 })
      grupoActivo.current.addLayer(e.layer)
      enlazar(e.layer)
      emitir()
    })
    m.on("pm:remove", (e: { layer: L.Layer }) => {
      grupoActivo.current?.removeLayer(e.layer)
      emitir()
    })
    m.on("pm:cut", () => window.setTimeout(emitir, 0))

    return () => {
      m.remove()
      mapa.current = null
      grupoActivo.current = null
      grupoOtras.current = null
      marcador.current = null
      // Un mapa nuevo (StrictMode, Fast Refresh) arranca sin capas: que se vuelvan a dibujar.
      claveActiva.current = null
      ultimaEmitida.current = ""
      vistaAjustada.current = false
    }
  }, [])

  // ── Controles de dibujo: sólo con una zona activa ──
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    m.pm.removeControls()
    if (zonaActiva) {
      m.pm.addControls({
        position: "topleft",
        drawMarker: false,
        drawCircleMarker: false,
        drawPolyline: false,
        drawCircle: false,
        drawText: false,
        drawRectangle: true,
        drawPolygon: true,
        editMode: true,
        dragMode: false,
        cutPolygon: true,
        removalMode: true,
        rotateMode: false,
        editControls: true,
      })
      const z = zonas.find((x) => x.clave === zonaActiva)
      if (z) m.pm.setGlobalOptions({ pathOptions: { color: z.color, fillColor: z.color, fillOpacity: 0.25, weight: 2 }, snappable: true })
    }
  }, [zonaActiva, zonas])

  // ── Capas: otras zonas (sólo lectura) y zona activa (editable) ──
  useEffect(() => {
    const m = mapa.current
    const otras = grupoOtras.current
    const activo = grupoActivo.current
    if (!m || !otras || !activo) return

    otras.clearLayers()
    zonas.forEach((z) => {
      if (z.clave === zonaActiva || z.geometria.length === 0) return
      const resaltada = z.clave === zonaResaltada
      const capa = L.polygon(geometriaALatLngs(z.geometria) as L.LatLngExpression[][][], {
        color: z.color,
        fillColor: z.color,
        weight: resaltada ? 4 : 2,
        fillOpacity: resaltada ? 0.4 : z.activa ? 0.15 : 0.04,
        dashArray: z.activa ? undefined : "6 6",
        // Geoman ignora estas capas: no se editan ni se cortan.
        pmIgnore: true,
      } as L.PolylineOptions)
      capa.bindTooltip(z.activa ? z.nombre : `${z.nombre} (inactiva)`, { sticky: true })
      capa.addTo(otras)
    })

    const actual = zonas.find((z) => z.clave === zonaActiva)
    const json = JSON.stringify(actual?.geometria ?? [])
    if (claveActiva.current !== zonaActiva || json !== ultimaEmitida.current) {
      claveActiva.current = zonaActiva
      ultimaEmitida.current = json
      activo.clearLayers()
      if (actual) {
        const resaltada = actual.clave === zonaResaltada
        for (const poligono of geometriaALatLngs(actual.geometria)) {
          const capa = L.polygon(poligono as L.LatLngExpression[][], {
            color: actual.color,
            fillColor: actual.color,
            weight: resaltada ? 4 : 2,
            fillOpacity: 0.25,
          })
          capa.addTo(activo)
          ;(activo as L.FeatureGroup & { __enlazar?: (c: L.Layer) => void }).__enlazar?.(capa)
        }
      }
    }
    // Primera vez con algo dibujado: encuadrar.
    if (!vistaAjustada.current) {
      const todas = zonas.flatMap((z) => z.geometria)
      if (todas.length > 0) {
        const v = vistaInicial([todas])
        m.setView(v.centro, v.zoom)
        vistaAjustada.current = true
      }
    }
  }, [zonas, zonaActiva, zonaResaltada])

  // ── Punto de la prueba de dirección ──
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    marcador.current?.remove()
    marcador.current = null
    if (punto) {
      marcador.current = L.circleMarker([punto.lat, punto.lon], {
        radius: 9,
        color: "#111827",
        weight: 3,
        fillColor: "#ffffff",
        fillOpacity: 1,
        pmIgnore: true,
      } as L.CircleMarkerOptions).addTo(m)
      m.setView([punto.lat, punto.lon], Math.max(m.getZoom(), 14))
    }
  }, [punto])

  return (
    <div
      ref={contenedor}
      role="application"
      aria-label="Mapa de zonas de envío"
      className="w-full overflow-hidden rounded-lg border border-border"
      style={{ height: 460, zIndex: 0 }}
    />
  )
}
