"use client"

import { useState, type ReactNode } from "react"
import { Tabs } from "@myd-org/ui"
import { CarritosAbandonadosShell } from "../carritos/CarritosAbandonadosShell"
import { AvisosReingresoShell } from "../avisos-reingreso/AvisosReingresoShell"
import { IntentosPagoShell } from "../pagos-intentos/IntentosPagoShell"
import { PESTANAS_PEDIDOS, pestanaValida, urlConPestana, type PestanaPedidos } from "./pestanas"

interface Props {
  /** `PedidosShell` ya armado por el server component: no se toca y queda siempre montado. */
  pedidos: ReactNode
  /** Pestaña inicial (`?tab=` de la URL, ya validada por el server). */
  inicial?: string
  /** Pestañas disponibles; la de Pedidos siempre está. */
  pestanas?: readonly PestanaPedidos[]
  /** Sucursales del tenant: rotulan las cuentas de cobro. */
  sucursales?: { slug: string; nombre: string }[]
}

// Pestañas dentro de Pedidos: "Pedidos | Carritos abandonados | Intentos de pago | Avisos de stock". Sin entrada nueva
// en el menú. La página que la usa ya exige admin+, así que las pestañas extra no llegan a otros roles.
// El panel de Pedidos queda siempre montado (oculto si no está activo) para conservar sus filtros y su
// página; los demás se montan al primer uso y quedan montados.
export function PedidosPestanas({ pedidos, inicial, pestanas = PESTANAS_PEDIDOS.map((p) => p.value), sucursales = [] }: Props) {
  const habilitadas = PESTANAS_PEDIDOS.filter((p) => pestanas.includes(p.value))
  const [activa, setActiva] = useState<PestanaPedidos>(pestanaValida(inicial, pestanas))
  const [vistas, setVistas] = useState<ReadonlySet<PestanaPedidos>>(() => new Set([pestanaValida(inicial, pestanas)]))

  function cambiar(valor: string) {
    const next = pestanaValida(valor, pestanas)
    setActiva(next)
    setVistas((v) => (v.has(next) ? v : new Set(v).add(next)))
    // Mantiene `?tab=` en la URL (recargar o compartir el enlace vuelve a la misma pestaña) sin
    // volver a pedirle la página al servidor ni mover el scroll.
    window.history.replaceState(null, "", urlConPestana(window.location.href, next))
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs items={habilitadas.map(({ value, label }) => ({ value, label }))} value={activa} onValueChange={cambiar} ariaLabel="Secciones de pedidos" />
      <div hidden={activa !== "pedidos"}>{pedidos}</div>
      {pestanas.includes("carritos") && vistas.has("carritos") && (
        <div hidden={activa !== "carritos"}>
          <CarritosAbandonadosShell />
        </div>
      )}
      {pestanas.includes("intentos") && vistas.has("intentos") && (
        <div hidden={activa !== "intentos"}>
          <IntentosPagoShell sucursales={sucursales} />
        </div>
      )}
      {pestanas.includes("avisos") && vistas.has("avisos") && (
        <div hidden={activa !== "avisos"}>
          <AvisosReingresoShell />
        </div>
      )}
    </div>
  )
}
