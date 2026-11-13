"use client"

import { useState } from "react"
import { Button, Field, Input, SegmentedControl } from "@myd-org/ui"
import type { SugerenciaDireccion } from "@/lib/nominatim-direcciones"
import type { ResultadoPruebaDireccion, ResultadoPruebaLocalidad } from "@/lib/metodos-envio-probar"
import { LocalidadSelector } from "./LocalidadSelector"

// "Prueba de dirección": busca una dirección (Nominatim, vía el proxy del admin), la dibuja en el mapa
// y muestra la zona, la regla usada, el precio y la promesa con las MISMAS funciones que decidirán en
// el Shop. Prueba el método tal como está en el formulario (aunque no esté guardado). "Solo localidad"
// muestra el precio estimado que verá el cliente en la ficha antes de dar su dirección.

type Modo = "direccion" | "localidad"
type Resultado = (ResultadoPruebaDireccion | ResultadoPruebaLocalidad) & { error?: string }

const REGLAS: Record<string, string> = {
  poligono: "El punto cae dentro del área dibujada",
  cp: "Por código postal",
  georef: "Por localidad",
}

const OPCIONES_MODO = [
  { value: "direccion", label: "Una dirección" },
  { value: "localidad", label: "Solo la localidad" },
]

export function PruebaDireccionPanel({
  cuerpoMetodo,
  localidadSugerida,
  provincia,
  zonaDeCuerpo,
  onPunto,
  onZona,
}: {
  /** El método tal como está en el formulario (se valida en el servidor). */
  cuerpoMetodo: () => unknown
  localidadSugerida: string
  provincia: string
  /** Clave local de la zona con ese nombre (para resaltarla en el mapa). */
  zonaDeCuerpo: (nombre: string) => string | null
  onPunto: (p: { lat: number; lon: number } | null) => void
  onZona: (clave: string | null) => void
}) {
  const [modo, setModo] = useState<Modo>("direccion")
  const [texto, setTexto] = useState("")
  const [ciudad, setCiudad] = useState(localidadSugerida)
  const [sugerencias, setSugerencias] = useState<SugerenciaDireccion[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState("")
  const [resultado, setResultado] = useState<Resultado | null>(null)

  async function buscar() {
    setErrorBusqueda("")
    setResultado(null)
    setSugerencias(null)
    if (texto.trim().length < 4) {
      setErrorBusqueda("Escriba al menos 4 caracteres de la dirección, por ejemplo la calle y la altura.")
      return
    }
    setBuscando(true)
    try {
      const qs = new URLSearchParams({ q: texto.trim(), provincia })
      if (ciudad.trim()) qs.set("ciudad", ciudad.trim())
      const res = await fetch(`/api/admin/envios/direcciones?${qs}`, { cache: "no-store" })
      const json = (await res.json().catch(() => null)) as { direcciones?: SugerenciaDireccion[]; error?: string } | null
      if (!res.ok || !json?.direcciones) setErrorBusqueda(json?.error ?? "No pudimos buscar la dirección. Inténtelo nuevamente.")
      else setSugerencias(json.direcciones)
    } catch {
      setErrorBusqueda("Error de conexión. Inténtelo nuevamente.")
    } finally {
      setBuscando(false)
    }
  }

  async function probar(cuerpo: Record<string, unknown>) {
    setResultado(null)
    try {
      const res = await fetch("/api/admin/envios/probar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metodo: cuerpoMetodo(), ...cuerpo }),
      })
      const json = (await res.json().catch(() => null)) as (Resultado & { error?: string }) | null
      if (!res.ok || !json) {
        setResultado({ aplica: false, mensaje: "", error: json?.error ?? "No pudimos hacer la prueba. Inténtelo nuevamente." })
        return null
      }
      setResultado(json)
      return json
    } catch {
      setResultado({ aplica: false, mensaje: "", error: "Error de conexión. Inténtelo nuevamente." })
      return null
    }
  }

  async function elegirDireccion(d: SugerenciaDireccion) {
    setSugerencias(null)
    onPunto({ lat: d.lat, lon: d.lon })
    const r = await probar({ modo: "direccion", punto: { lat: d.lat, lon: d.lon, precision: d.precision }, cp: d.cp || undefined })
    onZona(r && "zona" in r && r.aplica ? zonaDeCuerpo(r.zona) : null)
  }

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        ariaLabel="Tipo de prueba"
        options={OPCIONES_MODO}
        value={modo}
        onValueChange={(v) => {
          setModo(v as Modo)
          setResultado(null)
          setSugerencias(null)
          onPunto(null)
          onZona(null)
        }}
      />

      {modo === "direccion" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_16rem_auto] md:items-end">
          <Field label="Dirección" hint="Calle y altura, por ejemplo: Av. Colón 2500" error={errorBusqueda}>
            <Input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void buscar()
                }
              }}
              aria-invalid={Boolean(errorBusqueda)}
            />
          </Field>
          <Field label="Localidad" hint="Acota la búsqueda">
            <Input value={ciudad} onChange={(e) => setCiudad(e.target.value)} />
          </Field>
          <Button type="button" variant="secondary" onClick={() => void buscar()} disabled={buscando}>
            {buscando ? "Buscando…" : "Buscar"}
          </Button>
        </div>
      ) : (
        <div className="max-w-md">
          <LocalidadSelector
            label="Localidad"
            hint="Seleccione la localidad para ver el precio estimado."
            onSelect={(l) => void probar({ modo: "localidad", georefId: l.id })}
          />
        </div>
      )}

      {modo === "direccion" && sugerencias && (
        <div>
          {sugerencias.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              No encontramos esa dirección en la localidad indicada. Revise el nombre de la calle y la altura.
            </p>
          ) : (
            <ul className="flex flex-col gap-1" aria-label="Direcciones encontradas">
              {sugerencias.map((d) => (
                <li key={`${d.lat},${d.lon},${d.label}`}>
                  <button
                    type="button"
                    className="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent-soft"
                    onClick={() => void elegirDireccion(d)}
                  >
                    {d.label}
                    {d.precision === "calle" && <span style={{ color: "var(--ink-soft)" }}> · sin altura (ubicación aproximada)</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {resultado && (
        <div className="rounded-lg border border-border p-3 text-sm" role="status" aria-live="polite" style={{ color: "var(--ink)" }}>
          {resultado.error ? (
            <span style={{ color: "var(--red)" }}>{resultado.error}</span>
          ) : (
            <div className="flex flex-col gap-1">
              <strong>{resultado.mensaje}</strong>
              {"regla" in resultado && resultado.aplica && (
                <>
                  <span>Regla usada: {REGLAS[resultado.regla] ?? resultado.regla}.</span>
                  {resultado.promesa && <span>Promesa: {resultado.promesa}</span>}
                  <span>
                    Si el pago se confirmara ahora: {resultado.entrega.mismoDia ? "se entrega hoy" : `se entrega el ${resultado.entrega.fecha}`}.
                  </span>
                  {resultado.avisoFeriados && <span>{resultado.avisoFeriados}</span>}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
