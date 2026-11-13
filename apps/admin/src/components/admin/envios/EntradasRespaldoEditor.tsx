"use client"

import { useState } from "react"
import { Button, Chip, Field, Input } from "@myd-org/ui"
import type { FormEntrada } from "@/lib/metodos-envio-form"
import { LocalidadSelector } from "./LocalidadSelector"

// Respaldo opcional de una zona: localidades (Georef, por id) y códigos postales. Sirve para zonas que
// son una localidad entera o cuando no se pudo ubicar la dirección en el mapa. El dibujo en el mapa
// tiene prioridad sobre el CP, y éste sobre la localidad.

const CP = /^([0-9]{4}|[A-Za-z][0-9]{4}[A-Za-z]{3})$/

export function EntradasRespaldoEditor({
  zona,
  entradas,
  onChange,
}: {
  zona: string
  entradas: FormEntrada[]
  onChange: (entradas: FormEntrada[]) => void
}) {
  const [cp, setCp] = useState("")
  const [errorCp, setErrorCp] = useState("")

  const agregarCp = () => {
    const valor = cp.replace(/[\s-]/g, "").toUpperCase()
    if (!CP.test(valor)) {
      setErrorCp("Ingrese un código postal de 4 dígitos (por ejemplo 7600) o en formato CPA.")
      return
    }
    if (entradas.some((e) => e.tipo === "cp" && e.valor === valor)) {
      setErrorCp("Ese código postal ya está en esta zona.")
      return
    }
    onChange([...entradas, { tipo: "cp", valor, etiqueta: `CP ${valor}` }])
    setCp("")
    setErrorCp("")
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
        Opcional. Si la dirección no se puede ubicar en el mapa, el código postal o la localidad de la zona «{zona}» deciden el precio.
      </p>
      {entradas.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`Respaldo de la zona ${zona}`}>
          {entradas.map((e) => (
            <li key={`${e.tipo}:${e.valor}`}>
              <Chip
                variant="removable"
                removeLabel={`Quitar ${e.etiqueta}`}
                onRemove={() => onChange(entradas.filter((x) => !(x.tipo === e.tipo && x.valor === e.valor)))}
              >
                {e.etiqueta}
              </Chip>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <LocalidadSelector
          label="Agregar localidad"
          hint="Busque la localidad y selecciónela de la lista."
          excluir={entradas.filter((e) => e.tipo === "georef").map((e) => e.valor)}
          onSelect={(l) => onChange([...entradas, { tipo: "georef", valor: l.id, etiqueta: l.etiqueta }])}
        />
        <Field label="Agregar código postal" error={errorCp}>
          <div className="flex gap-2">
            <Input
              inputMode="text"
              placeholder="7600"
              value={cp}
              onChange={(e) => {
                setCp(e.target.value)
                setErrorCp("")
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  agregarCp()
                }
              }}
              aria-invalid={Boolean(errorCp)}
            />
            <Button type="button" variant="secondary" onClick={agregarCp}>
              Agregar
            </Button>
          </div>
        </Field>
      </div>
    </div>
  )
}
