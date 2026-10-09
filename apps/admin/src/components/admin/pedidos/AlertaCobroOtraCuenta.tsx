import { Alert } from "@myd-org/ui"
import type { CuentaCobroDto, PagoEnLineaDto } from "@/lib/pago-en-linea"
import { PROCESADOR } from "./format"

// Alerta de la tarjeta "Pago" del pedido: el cobro en línea se hizo con la cuenta de otra sucursal
// porque la que correspondía no tenía credenciales cargadas o el procesador las rechazó (fallback
// del Shop; change `cuentas-procesador-por-sucursal`). Los nombres salen de las sucursales; si un
// slug ya no existe se muestra el slug.

export function textoCobroConOtraCuenta(
  cuenta: Pick<CuentaCobroDto, "slug" | "prevista">,
  proveedor: string,
  nombresSucursal: Record<string, string>,
): string {
  const nombre = (slug: string) => nombresSucursal[slug] ?? slug
  const prevista = nombre(cuenta.prevista ?? cuenta.slug)
  const procesador = Object.hasOwn(PROCESADOR, proveedor) ? PROCESADOR[proveedor] : "el procesador"
  return (
    `Se cobró con la cuenta de ${nombre(cuenta.slug)} en lugar de la de ${prevista}. ` +
    `Revise las credenciales de ${prevista} en ${procesador}: no estaban cargadas o el procesador las rechazó.`
  )
}

export function AlertaCobroOtraCuenta({
  pago,
  nombresSucursal = {},
}: {
  pago: PagoEnLineaDto | null | undefined
  nombresSucursal?: Record<string, string>
}) {
  if (!pago?.cuenta?.fallback) return null
  return (
    <div className="mb-2">
      <Alert tone="warning" title="Cobro con otra cuenta">
        {textoCobroConOtraCuenta(pago.cuenta, pago.proveedor, nombresSucursal)}
      </Alert>
    </div>
  )
}
