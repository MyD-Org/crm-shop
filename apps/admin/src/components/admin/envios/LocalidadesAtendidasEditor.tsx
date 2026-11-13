"use client"

import { Button, Field, Input } from "@myd-org/ui"
import type { FormLocalidad } from "@/lib/metodos-envio-form"
import { LocalidadSelector } from "./LocalidadSelector"

// "Localidades que atiende": las que se ofrecen primero en el buscador de la tienda y sus
// abreviaturas (por ejemplo "mdp" para Mar del Plata). El centro y el rectángulo de cada una los
// completa el servidor al guardar y sirven para anticipar el precio antes de tener la dirección.

export function LocalidadesAtendidasEditor({
  localidades,
  onChange,
}: {
  localidades: FormLocalidad[]
  onChange: (l: FormLocalidad[]) => void
}) {
  const cambiar = (i: number, parcial: Partial<FormLocalidad>) =>
    onChange(localidades.map((l, j) => (j === i ? { ...l, ...parcial } : l)))

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
        Las localidades que agregue acá aparecen primero cuando el cliente busca dónde recibir su pedido, y sus abreviaturas se reconocen al
        escribirlas. También sirven para mostrar “desde $X” en la ficha del producto.
      </p>
      {localidades.length > 0 && (
        <ul className="flex flex-col gap-2">
          {localidades.map((l, i) => (
            <li key={l.georefId} className="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_16rem_auto]">
              <div className="text-sm" style={{ color: "var(--ink)" }}>
                {l.etiqueta}
              </div>
              <Field label="Abreviaturas" hint="Separadas por coma, por ejemplo: mdp">
                <Input value={l.abreviaturas} onChange={(e) => cambiar(i, { abreviaturas: e.target.value })} placeholder="mdp" />
              </Field>
              <Button type="button" variant="ghost" onClick={() => onChange(localidades.filter((_, j) => j !== i))} aria-label={`Quitar ${l.etiqueta}`}>
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="max-w-md">
        <LocalidadSelector
          label="Agregar localidad atendida"
          hint="Busque la localidad y selecciónela de la lista."
          excluir={localidades.map((l) => l.georefId)}
          onSelect={(l) => onChange([...localidades, { georefId: l.id, etiqueta: l.etiqueta, abreviaturas: "" }])}
        />
      </div>
    </div>
  )
}
