"use client"

import { useState } from "react"
import { Alert, Button, Field, Input } from "@myd-org/ui"
import { CodigosRespaldo } from "@/components/admin/CodigosRespaldo"

export function SeguridadCuenta({ activadaEn, restantes }: { activadaEn: string | null; restantes: number }) {
  const [codigo, setCodigo] = useState("")
  const [error, setError] = useState("")
  const [cargando, setCargando] = useState(false)
  const [nuevos, setNuevos] = useState<string[] | null>(null)
  const [quedan, setQuedan] = useState(restantes)

  async function generar(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setCargando(true)
    try {
      const res = await fetch("/api/admin/cuenta/2fa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codigo }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "No se pudieron generar los códigos.")
        return
      }
      setNuevos(body.codigosRespaldo)
      setQuedan(body.codigosRespaldo.length)
      setCodigo("")
    } finally {
      setCargando(false)
    }
  }

  const fecha = activadaEn
    ? new Date(activadaEn).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" })
    : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold" style={{ color: "var(--ink)" }}>Seguridad</h1>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Verificación en dos pasos {fecha ? `activa desde el ${fecha}` : "activa"}. Al ingresar se le pide el código de su app autenticadora.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>Códigos de respaldo</h2>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Le quedan {quedan} {quedan === 1 ? "código" : "códigos"} sin usar. Si genera códigos nuevos, los anteriores dejan de servir.
        </p>
        {quedan <= 3 && !nuevos && <Alert tone="warning">Le quedan pocos códigos de respaldo. Genere códigos nuevos.</Alert>}

        {nuevos ? (
          <CodigosRespaldo codigos={nuevos} />
        ) : (
          <form onSubmit={generar} className="flex flex-col gap-3">
            <Field label="Código de su app autenticadora">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                placeholder="123456"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                required
              />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" loading={cargando} className="w-fit">Generar códigos nuevos</Button>
          </form>
        )}
      </section>

      <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
        ¿Cambió de celular o lo perdió? Pídale a un administrador que restablezca su verificación desde Usuarios.
      </p>
    </div>
  )
}
