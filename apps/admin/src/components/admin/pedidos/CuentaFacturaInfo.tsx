"use client"

import { useEffect, useState } from "react"
import { Alert } from "@myd-org/ui"
import type { CuentaFacturaDto } from "@/lib/pedido-factura-cuenta-repo"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { fmtFechaPedido } from "./format"

// "Cuenta que factura" en el detalle del pedido (change `sucursales-igz-mdp`, rebanada D): qué
// cuenta de Alegra factura (o facturó) el pedido y por qué, con el aviso de venta entre empresas
// cuando no es la de la sucursal que despacha. Solo lectura: la cuenta se elige al emitir la factura.

export function textoVentaEntreEmpresas(d: Pick<CuentaFacturaDto, "despacha" | "efectiva" | "emitida">): string {
  const factura = d.emitida?.nombre ?? d.efectiva?.nombre ?? "otra cuenta"
  const desde = d.despacha.sucursal ?? "la sucursal del pedido"
  const cuentaDespacha = d.despacha.cuentaNombre ? ` (${d.despacha.cuentaNombre})` : ""
  return (
    `La mercadería sale de ${desde}${cuentaDespacha}, pero se factura con la cuenta de ${factura}. ` +
    "El stock lo sigue descontando la sucursal que despacha: el ajuste entre las dos empresas se hace por fuera."
  )
}

export function CuentaFacturaInfo({ pedido }: { pedido: PedidoDetalleDto }) {
  const [dto, setDto] = useState<CuentaFacturaDto | null>(null)
  const facturaId = pedido.factura?.alegraId ?? null

  useEffect(() => {
    let cancelado = false
    void fetch(`/api/admin/pedidos/${pedido.id}/factura/cuenta`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: unknown) => {
        if (!cancelado && b && typeof b === "object" && "cuentas" in b) setDto(b as CuentaFacturaDto)
      })
      .catch(() => {})
    return () => {
      cancelado = true
    }
  }, [pedido.id, facturaId])

  if (!dto || dto.cuentas.length < 2) return null

  const cuenta = dto.emitida ?? dto.efectiva
  return (
    <div className="mb-3 flex flex-col gap-2 border-b pb-3" style={{ borderColor: "var(--border)" }}>
      <div>
        {dto.emitida && (
          <p className="text-xs" style={{ color: "var(--ink-faint)" }}>Facturada con la cuenta de</p>
        )}
        <p className="text-sm" style={{ color: "var(--ink)" }}>
          {cuenta ? cuenta.nombre : "Sin cuenta asignada"}
        </p>
        {dto.override && (
          <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
            Elegida por {dto.override.por ?? "un operador"} el {fmtFechaPedido(dto.override.en)}
            {dto.override.anterior ? ` (antes: ${dto.override.anterior})` : ""}
          </p>
        )}
      </div>
      {dto.cruzada && (
        <Alert tone="warning" title="Venta entre empresas">
          {textoVentaEntreEmpresas(dto)}
        </Alert>
      )}
    </div>
  )
}
