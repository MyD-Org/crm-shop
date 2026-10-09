"use client"

import { Alert, Checkbox } from "@myd-org/ui"
import type { AvisoCobroDto } from "@/lib/pedido-factura-cuenta-repo"

// Aviso de "Emitir factura" cuando el pedido se cobró en línea con la cuenta de una sucursal y se va
// a facturar con otra cuenta de Alegra (change `cuentas-procesador-por-sucursal`, R3). No bloquea:
// una vez marcada la casilla se puede emitir.

export const textoAvisoCuentaDistintaDeCobro = (a: AvisoCobroDto): string =>
  `Este pedido se cobró en línea con la cuenta de ${a.cobradoCon.nombre}, pero se va a facturar con la cuenta de ${a.facturaCon.nombre}. ` +
  "Facturar con un CUIT distinto del que recibió el cobro puede generar diferencias contables. " +
  "Si desea continuar, confirme a continuación."

/** Sin aviso no hace falta confirmar; con aviso, sólo después de marcar la casilla. */
export const puedeEmitirConAvisoCobro = (aviso: AvisoCobroDto | null | undefined, confirmado: boolean): boolean =>
  !aviso || confirmado

export function AvisoCuentaDistintaDeCobro({
  aviso,
  confirmado,
  onConfirmadoChange,
  disabled,
}: {
  aviso: AvisoCobroDto | null | undefined
  confirmado: boolean
  onConfirmadoChange: (confirmado: boolean) => void
  disabled?: boolean
}) {
  if (!aviso) return null
  return (
    <div className="flex flex-col gap-2">
      <Alert tone="warning" title="Cuenta distinta de la que cobró">
        {textoAvisoCuentaDistintaDeCobro(aviso)}
      </Alert>
      <label className="flex cursor-pointer items-start gap-2 text-sm" style={{ color: "var(--ink)" }}>
        <Checkbox checked={confirmado} onCheckedChange={onConfirmadoChange} disabled={disabled} />
        Entiendo que se factura con una cuenta distinta de la que cobró y deseo continuar.
      </label>
    </div>
  )
}
