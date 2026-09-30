"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button, Progress } from "@myd-org/ui"

// Botón "Sincronizar con Alegra" del catálogo (admin+). La sincronización de un catálogo grande
// no entra en una sola llamada (la cuenta principal tarda varios minutos): el servidor trabaja por
// tramos y responde `continuar: true` con el avance; acá se lo vuelve a llamar hasta que termina.
// Si se cierra la pantalla a mitad, la corrida queda guardada y el próximo clic la retoma.

const MAX_TRAMOS = 15

interface CuentaResultado {
  ok: boolean
  cuenta: string
  parcial?: boolean
  itemsSynced: number
  pareados?: number
  soloSecundaria?: number
}

interface RespuestaSync {
  ok: boolean
  continuar?: boolean
  parcial?: boolean
  itemsSynced: number
  categoriesSynced: number
  error?: string
  progreso?: { cuenta: string; leidos: number; estimado: number | null; restantes: number }
  cuentas?: CuentaResultado[]
}

const num = (n: number) => n.toLocaleString("es-AR")

function textoProgreso(p: NonNullable<RespuestaSync["progreso"]>): string {
  if (p.cuenta === "principal") {
    return p.estimado
      ? `Sincronizando… cuenta principal, ${num(p.leidos)} de unos ${num(p.estimado)}`
      : `Sincronizando… cuenta principal, ${num(p.leidos)} productos leídos`
  }
  return `Sincronizando… cuenta secundaria ${p.cuenta}`
}

/** El detalle interno de Alegra nunca se muestra: solo el aviso de corrida en curso, que es propio. */
function textoError(error: string | undefined): string {
  if (error && /en curso/i.test(error)) return error
  return "La sincronización no pudo completarse. Inténtelo nuevamente en unos minutos."
}

export function SincronizarAlegra({ onTerminado }: { onTerminado: () => void }) {
  const [sincronizando, setSincronizando] = useState(false)
  const [avance, setAvance] = useState<RespuestaSync["progreso"] | null>(null)
  const [resultado, setResultado] = useState<RespuestaSync | null>(null)
  const [error, setError] = useState("")

  async function sincronizar() {
    setSincronizando(true)
    setError("")
    setResultado(null)
    setAvance(null)
    try {
      for (let tramo = 1; tramo <= MAX_TRAMOS; tramo++) {
        let res: Response
        try {
          res = await fetch("/api/admin/catalog/sync", { method: "POST", cache: "no-store" })
        } catch {
          setError("No pudimos conectarnos. Revise su conexión e inténtelo nuevamente: la sincronización retoma donde quedó.")
          return
        }
        const cuerpo = (await res.json().catch(() => null)) as RespuestaSync | null
        if (!res.ok || !cuerpo || !cuerpo.ok) {
          setError(textoError(cuerpo?.error))
          if (cuerpo?.cuentas) setResultado(cuerpo)
          return
        }
        if (!cuerpo.continuar) {
          setResultado(cuerpo)
          setAvance(null)
          onTerminado()
          return
        }
        setAvance(cuerpo.progreso ?? null)
      }
      setError("La sincronización sigue en curso. Vuelva a pulsar el botón para continuar.")
    } finally {
      setSincronizando(false)
    }
  }

  const fraccion = avance?.estimado ? Math.min(100, Math.round((avance.leidos / avance.estimado) * 100)) : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" loading={sincronizando} onClick={() => void sincronizar()}>
          <RefreshCw size={13} /> Sincronizar con Alegra
        </Button>
        {sincronizando && (
          <span className="text-xs" style={{ color: "var(--ink-soft)" }} role="status">
            {avance ? textoProgreso(avance) : "Sincronizando…"}
          </span>
        )}
      </div>

      {sincronizando && fraccion !== null && <Progress value={fraccion} />}

      {error && (
        <p className="text-sm" style={{ color: "var(--red)" }} role="alert">
          {error}
        </p>
      )}

      {resultado && !sincronizando && (
        <ul className="text-xs flex flex-col gap-0.5" style={{ color: "var(--ink-soft)" }} role="status">
          <li>
            Cuenta principal: {num(resultado.itemsSynced)} productos y {num(resultado.categoriesSynced)} categorías
            {resultado.parcial ? " · incompleta: no se dieron de baja productos" : ""}
          </li>
          {(resultado.cuentas ?? []).map((c) => (
            <li key={c.cuenta}>
              Cuenta {c.cuenta}:{" "}
              {c.ok
                ? `${num(c.itemsSynced)} productos leídos${c.pareados !== undefined ? `, ${num(c.pareados)} pareados` : ""}${
                    c.soloSecundaria ? `, ${num(c.soloSecundaria)} solo en esta cuenta` : ""
                  }${c.parcial ? " · incompleta: no se dieron de baja productos" : ""}`
                : "no se pudo sincronizar"}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
