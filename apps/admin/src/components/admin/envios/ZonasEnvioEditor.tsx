"use client"

import { useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Button, Field, Input, Switch } from "@myd-org/ui"
import { colorDeZona, geojsonAGeometria, geometriaAGeojson } from "@/lib/mapa-zonas"
import { zonaVacia, type FormZona } from "@/lib/metodos-envio-form"
import type { Geometria } from "@/lib/geo-poligono"
import { EntradasRespaldoEditor } from "./EntradasRespaldoEditor"
import type { ZonaMapa } from "./MapaZonasEditor"

// Zonas del método: nombre, precio final (con IVA), orden y estado de cada una, más el mapa donde se
// dibuja el área de la zona seleccionada. Leaflet sólo existe en el navegador: se carga con
// next/dynamic({ ssr: false }) desde este componente cliente.

const MapaZonasEditor = dynamic(() => import("./MapaZonasEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[460px] items-center justify-center rounded-lg border border-border text-sm" style={{ color: "var(--ink-soft)" }}>
      Cargando el mapa…
    </div>
  ),
})

export function ZonasEnvioEditor({
  zonas,
  onChange,
  seleccionada,
  onSeleccionar,
  punto,
  zonaResaltada,
  errores,
}: {
  zonas: FormZona[]
  onChange: (zonas: FormZona[]) => void
  seleccionada: string | null
  onSeleccionar: (clave: string | null) => void
  punto?: { lat: number; lon: number } | null
  zonaResaltada?: string | null
  errores: Record<string, string>
}) {
  const archivo = useRef<HTMLInputElement>(null)
  const [avisoGeojson, setAvisoGeojson] = useState("")

  const cambiar = (clave: string, parcial: Partial<FormZona>) => onChange(zonas.map((z) => (z.clave === clave ? { ...z, ...parcial } : z)))

  const agregar = () => {
    const z = zonaVacia(zonas)
    onChange([...zonas, z])
    onSeleccionar(z.clave)
  }

  const quitar = (clave: string) => {
    onChange(zonas.filter((z) => z.clave !== clave))
    if (seleccionada === clave) onSeleccionar(null)
  }

  const activa = zonas.find((z) => z.clave === seleccionada) ?? null

  const zonasMapa: ZonaMapa[] = zonas.map((z, i) => ({
    clave: z.clave,
    nombre: z.nombre || `Zona ${i + 1}`,
    color: colorDeZona(i),
    activa: z.activa,
    geometria: z.geometria,
  }))

  const exportar = () => {
    if (!activa) return
    const blob = new Blob([JSON.stringify(geometriaAGeojson(activa.geometria, activa.nombre), null, 2)], { type: "application/geo+json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `zona-${activa.nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "envio"}.geojson`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importar = async (f: File | undefined) => {
    if (!f || !activa) return
    if (f.size > 2_000_000) {
      setAvisoGeojson("El archivo es demasiado grande (máximo 2 MB).")
      return
    }
    const r = geojsonAGeometria(await f.text())
    if (!r.ok) {
      setAvisoGeojson(r.error)
      return
    }
    cambiar(activa.clave, { geometria: r.g as Geometria })
    setAvisoGeojson("")
  }

  return (
    <div className="flex flex-col gap-4">
      {errores.zonas && (
        <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
          {errores.zonas}
        </p>
      )}

      {zonas.length === 0 && (
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Todavía no hay zonas. Agregue una, póngale un precio y dibuje su área en el mapa.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {zonas.map((z, i) => {
          const esActiva = z.clave === seleccionada
          const e = (campo: string) => errores[`zonas.${i}.${campo}`]
          return (
            <li
              key={z.clave}
              className="rounded-lg border p-3"
              style={{ borderColor: esActiva ? colorDeZona(i) : "var(--border)", borderWidth: esActiva ? 2 : 1 }}
            >
              <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[auto_1fr_10rem_6rem_auto_auto]">
                <span aria-hidden className="mb-2 inline-block h-4 w-4 rounded-full" style={{ background: colorDeZona(i) }} />
                <Field label="Nombre de la zona" error={e("nombre")}>
                  <Input value={z.nombre} onChange={(ev) => cambiar(z.clave, { nombre: ev.target.value })} aria-invalid={Boolean(e("nombre"))} />
                </Field>
                <Field label="Precio con IVA ($)" error={e("precio")}>
                  <Input
                    inputMode="decimal"
                    placeholder="3000"
                    value={z.precio}
                    onChange={(ev) => cambiar(z.clave, { precio: ev.target.value })}
                    aria-invalid={Boolean(e("precio"))}
                  />
                </Field>
                <Field label="Orden" hint="Menor gana si se superponen" error={e("orden")}>
                  <Input inputMode="numeric" value={z.orden} onChange={(ev) => cambiar(z.clave, { orden: ev.target.value })} />
                </Field>
                <Switch
                  id={`zona-activa-${z.clave}`}
                  checked={z.activa}
                  onCheckedChange={(v) => cambiar(z.clave, { activa: v })}
                  label={z.activa ? "Activa" : "Inactiva"}
                />
                <div className="flex gap-2">
                  <Button type="button" variant={esActiva ? "primary" : "secondary"} onClick={() => onSeleccionar(esActiva ? null : z.clave)}>
                    {esActiva ? "Editando en el mapa" : "Editar en el mapa"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => quitar(z.clave)} aria-label={`Quitar la zona ${z.nombre}`}>
                    Quitar
                  </Button>
                </div>
              </div>
              {(e("geometria") || e("entradas") || errores[`zonas.${i}`]) && (
                <p className="mt-2 text-sm" role="alert" style={{ color: "var(--red)" }}>
                  {e("geometria") || e("entradas") || errores[`zonas.${i}`]}
                </p>
              )}
              <p className="mt-2 text-xs" style={{ color: "var(--ink-soft)" }}>
                {z.geometria.length === 0
                  ? "Sin dibujo en el mapa."
                  : `${z.geometria.length} ${z.geometria.length === 1 ? "área dibujada" : "áreas dibujadas"}.`}
              </p>
              {esActiva && (
                <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                  <EntradasRespaldoEditor zona={z.nombre} entradas={z.entradas} onChange={(entradas) => cambiar(z.clave, { entradas })} />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div>
        <Button type="button" variant="secondary" onClick={agregar}>
          Agregar zona
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm" style={{ color: "var(--ink)" }}>
          {activa
            ? `Dibujando la zona «${activa.nombre}». Use las herramientas de la izquierda del mapa para dibujar un polígono o un rectángulo, editar los vértices, cortar un hueco o borrar. Las demás zonas se ven en sólo lectura.`
            : "Seleccione una zona con “Editar en el mapa” para dibujar su área."}
        </p>
        <MapaZonasEditor
          zonas={zonasMapa}
          zonaActiva={seleccionada}
          onGeometria={(clave, g) => cambiar(clave, { geometria: g })}
          punto={punto}
          zonaResaltada={zonaResaltada}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!activa || activa.geometria.length === 0} onClick={exportar}>
            Exportar GeoJSON
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!activa} onClick={() => archivo.current?.click()}>
            Importar GeoJSON
          </Button>
          <input
            ref={archivo}
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            className="hidden"
            onChange={(ev) => {
              void importar(ev.target.files?.[0])
              ev.target.value = ""
            }}
          />
          <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
            Importar reemplaza el dibujo de la zona seleccionada.
          </span>
        </div>
        {avisoGeojson && (
          <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
            {avisoGeojson}
          </p>
        )}
      </div>
    </div>
  )
}
