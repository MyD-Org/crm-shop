"use client"

import { useEffect, useState } from "react"
import { Badge, Button, Card } from "@myd-org/ui"
import { dtoAForm, formVacio, resumenMetodo, type FormMetodo } from "@/lib/metodos-envio-form"
import type { MetodoEnvioDto } from "@/lib/metodos-envio-repo"
import { MetodoEnvioEditor } from "./MetodoEnvioEditor"

// Métodos de envío por zona ("Envío en el día"): lista con un resumen en lenguaje simple y editor con
// mapa. Se muestra sólo para configurar; el Shop los ofrece cuando el método está activo y el envío
// por zona está habilitado. Rige para los pedidos NUEVOS.

export function MetodosEnvioCard() {
  const [metodos, setMetodos] = useState<MetodoEnvioDto[] | null>(null)
  const [errorCarga, setErrorCarga] = useState(false)
  const [editando, setEditando] = useState<{ clave: string; form: FormMetodo } | null>(null)

  const cargar = () => {
    fetch("/api/admin/metodos-envio", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { metodos?: MetodoEnvioDto[] } | null
        if (!res.ok || !json?.metodos) setErrorCarga(true)
        else {
          setMetodos(json.metodos)
          setErrorCarga(false)
        }
      })
      .catch(() => setErrorCarga(true))
  }

  useEffect(() => {
    let vivo = true
    fetch("/api/admin/metodos-envio", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { metodos?: MetodoEnvioDto[] } | null
        if (!vivo) return
        if (!res.ok || !json?.metodos) setErrorCarga(true)
        else setMetodos(json.metodos)
      })
      .catch(() => vivo && setErrorCarga(true))
    return () => {
      vivo = false
    }
  }, [])

  return (
    <Card
      title="Envío en el día"
      description="Defina las zonas de entrega dibujándolas en el mapa y el precio de cada una. Rige para los pedidos nuevos; los pedidos ya creados conservan el precio con el que se tomaron."
      action={
        !editando ? (
          <Button variant="secondary" onClick={() => setEditando({ clave: "nuevo", form: formVacio() })}>
            Nuevo método
          </Button>
        ) : undefined
      }
    >
      {errorCarga && (
        <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
          No pudimos cargar los métodos de envío. Recargue la página.
        </p>
      )}
      {!metodos && !errorCarga && (
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Cargando…
        </p>
      )}

      {editando ? (
        <MetodoEnvioEditor
          key={editando.clave}
          inicial={editando.form}
          onGuardado={(m) => {
            cargar()
            // Se queda editando con lo guardado (ids de zona ya asignados).
            setEditando({ clave: m.id, form: dtoAForm(m) })
          }}
          onEliminado={() => {
            setEditando(null)
            cargar()
          }}
          onCancelar={() => {
            setEditando(null)
            cargar()
          }}
        />
      ) : (
        metodos && (
          <div className="flex flex-col gap-3">
            {metodos.length === 0 && (
              <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                Todavía no cargó ningún método. Cree uno para ofrecer envío en el día con precio por zona.
              </p>
            )}
            {metodos.map((m) => (
              <div key={m.id} className="flex flex-col gap-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <strong style={{ color: "var(--ink)" }}>{m.nombre}</strong>
                    <Badge tone={m.activo ? "success" : "neutral"}>{m.activo ? "Activo" : "Inactivo"}</Badge>
                  </div>
                  <Button variant="secondary" onClick={() => setEditando({ clave: m.id, form: dtoAForm(m) })}>
                    Editar
                  </Button>
                </div>
                <ul className="list-disc pl-5 text-sm" style={{ color: "var(--ink-soft)" }}>
                  {resumenMetodo(m).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      )}
    </Card>
  )
}
