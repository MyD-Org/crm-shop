"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Alert, Badge, Card, Table, type TableColumn, useToast } from "@myd-org/ui"
import type { PedidoDetalleDto, PedidoItemDto } from "@/lib/pedidos-repo"
import { ESTADO_PEDIDO_LABEL } from "@/lib/pedidos-transiciones"
import { CambiarEstadoControl } from "./CambiarEstadoControl"
import {
  PAGO_REVISION_INFO,
  condicionIvaLabel,
  entregaLabel,
  fmtCantidad,
  fmtFechaPedido,
  fmtMoneda,
  pagoEstadoLabel,
  pagoMetodoLabel,
  textoUltimoCambio,
  tonoEstado,
} from "./format"

const ERROR_RECARGA = "No se pudo cargar el pedido. Inténtelo nuevamente."

/** Un dato con su rótulo. Sin valor muestra una raya: que falte se tiene que notar. */
function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs" style={{ color: "var(--ink-faint)" }}>{label}</dt>
      <dd className="text-sm break-words" style={{ color: "var(--ink)" }}>{children || "—"}</dd>
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Card title={titulo} className="p-4">
      {children}
    </Card>
  )
}

export function PedidoDetalle({ initial }: { initial: PedidoDetalleDto }) {
  const { toast } = useToast()
  const [pedido, setPedido] = useState(initial)

  /** Vuelve a pedir el pedido. `avisar`: si falla, lo dice (tras un 409 el operador lo espera). */
  const recargar = useCallback(
    async (avisar: boolean) => {
      const res = await fetch(`/api/admin/pedidos/${initial.id}`, { cache: "no-store" }).catch(() => null)
      const data = res?.ok ? ((await res.json().catch(() => null)) as PedidoDetalleDto | null) : null
      if (data && typeof data.id === "string") setPedido(data)
      else if (avisar) toast({ title: ERROR_RECARGA, tone: "danger" })
    },
    [initial.id, toast],
  )

  // Al montar: con `staleTimes.dynamic = 30`, volver a este pedido dentro de los 30 s trae el
  // HTML cacheado, con el estado de ANTES del último cambio. Se refresca en silencio.
  useEffect(() => {
    void (async () => {
      await recargar(false)
    })()
  }, [recargar])

  const ultimoCambio = textoUltimoCambio(pedido.estadoActualizadoPorNombre, pedido.estadoActualizadoEn)
  const documento = [pedido.facturacion.tipoDoc, pedido.facturacion.nroDoc].filter(Boolean).join(" ")
  const esEnvio = pedido.entrega.tipo === "envio"

  const columns: TableColumn<PedidoItemDto>[] = [
    {
      key: "producto",
      header: "Producto",
      render: (i) => (
        <>
          <div className="font-medium" style={{ color: "var(--ink)" }}>{i.name}</div>
          {(i.code || i.brand) && (
            <div className="text-xs" style={{ color: "var(--ink-faint)" }}>
              {[i.code, i.brand].filter(Boolean).join(" · ")}
            </div>
          )}
        </>
      ),
    },
    {
      key: "qty",
      header: "Cant.",
      align: "right",
      className: "tabular-nums",
      render: (i) => <span style={{ color: "var(--ink)" }}>{fmtCantidad(i.qty)}</span>,
    },
    {
      key: "precio",
      header: "Precio unit.",
      align: "right",
      hideBelow: "sm",
      className: "tabular-nums",
      render: (i) => <span style={{ color: "var(--ink-soft)" }}>{fmtMoneda(i.precioUnitario)}</span>,
    },
    {
      key: "iva",
      header: "IVA",
      align: "right",
      hideBelow: "md",
      className: "tabular-nums text-xs",
      render: (i) => <span style={{ color: "var(--ink-soft)" }}>{fmtCantidad(i.ivaPorcentaje)} %</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      className: "font-medium tabular-nums",
      render: (i) => <span style={{ color: "var(--ink)" }}>{fmtMoneda(i.total)}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* pl-10 md:pl-0: en mobile corre el encabezado para que no lo tape el botón ☰ del sidebar. */}
      <div className="pl-10 md:pl-0">
        <Link
          href="/admin/pedidos"
          className="inline-flex items-center gap-1 text-xs hover:underline"
          style={{ color: "var(--ink-soft)" }}
        >
          <ArrowLeft size={13} /> Volver a Pedidos
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
            Pedido {pedido.numero}
          </h1>
          <Badge tone={tonoEstado(pedido.estado)}>{ESTADO_PEDIDO_LABEL[pedido.estado]}</Badge>
          {pedido.requiereRevision && (
            <span title="El documento ya es de un cliente de Alegra que no vinculó su cuenta: revíselo antes de facturar.">
              <Badge tone="warning">Revisar</Badge>
            </span>
          )}
          {pedido.pagoRevision && (
            <Badge tone="danger">{PAGO_REVISION_INFO[pedido.pagoRevision].label}</Badge>
          )}
        </div>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Realizado el {fmtFechaPedido(pedido.creadoEn)}
        </p>
        {pedido.pagoRevision && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {PAGO_REVISION_INFO[pedido.pagoRevision].detalle}
          </p>
        )}
      </div>

      {pedido.requiereRevision && (
        <Alert tone="warning" title="Revise el cliente antes de facturar">
          {/* Lo marca el Shop: el documento de facturación coincide con un contacto de
              Alegra, pero el comprador no vinculó su cuenta (compró a precio de lista). */}
          El documento {documento || "de facturación"} ya está registrado en Alegra, pero el
          comprador no vinculó su cuenta y compró a precio de lista. Facture a ese contacto
          existente en lugar de crear uno nuevo, y verifique si corresponde aplicarle su lista
          de precios.
        </Alert>
      )}

      <Seccion titulo="Estado del pedido">
        <CambiarEstadoControl
          pedidoId={pedido.id}
          estado={pedido.estado}
          onChanged={setPedido}
          onConflicto={() => void recargar(true)}
        />
      </Seccion>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Seccion titulo="Contacto">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Dato label="Nombre">{pedido.contacto.nombre}</Dato>
            <Dato label="Teléfono">{pedido.contacto.telefono}</Dato>
            <Dato label="Email">{pedido.cliente.email}</Dato>
            <Dato label="Cliente">
              {[pedido.cliente.razonSocial, pedido.cliente.codigo && `Cód. ${pedido.cliente.codigo}`]
                .filter(Boolean)
                .join(" · ")}
            </Dato>
          </dl>
        </Seccion>

        <Seccion titulo="Entrega">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Dato label="Tipo">{entregaLabel(pedido.entrega.tipo)}</Dato>
            {(esEnvio || pedido.entrega.ciudad) && <Dato label="Ciudad">{pedido.entrega.ciudad}</Dato>}
            {(esEnvio || pedido.entrega.direccion) && <Dato label="Dirección">{pedido.entrega.direccion}</Dato>}
          </dl>
        </Seccion>

        <Seccion titulo="Facturación">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Dato label="Razón social">{pedido.facturacion.razonSocial}</Dato>
            <Dato label="Documento">{documento}</Dato>
            <Dato label="Condición de IVA">{condicionIvaLabel(pedido.facturacion.condicionIva)}</Dato>
            <Dato label="Domicilio">{pedido.facturacion.domicilio}</Dato>
          </dl>
        </Seccion>

        <Seccion titulo="Pago">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Dato label="Medio de pago">{pagoMetodoLabel(pedido.pagoMetodo)}</Dato>
            <Dato label="Estado del pago">{pagoEstadoLabel(pedido.pagoEstado)}</Dato>
          </dl>
        </Seccion>
      </div>

      <Seccion titulo="Aclaraciones del cliente">
        <p className="text-sm whitespace-pre-wrap break-words" style={{ color: pedido.notas ? "var(--ink)" : "var(--ink-faint)" }}>
          {pedido.notas || "El cliente no dejó aclaraciones."}
        </p>
      </Seccion>

      <Seccion titulo="Productos">
        <Table<PedidoItemDto>
          columns={columns}
          rows={pedido.items}
          rowKey={(i) => i.id}
          empty="Este pedido no tiene productos."
        />
        <dl className="mt-3 ml-auto flex w-full max-w-xs flex-col gap-1 text-sm tabular-nums">
          <Total label="Subtotal" valor={fmtMoneda(pedido.subtotal)} />
          <Total label="IVA" valor={fmtMoneda(pedido.iva)} />
          <Total label="Envío" valor={fmtMoneda(pedido.costoEnvio)} />
          <Total label="Total" valor={fmtMoneda(pedido.total)} destacado />
        </dl>
      </Seccion>

      <Seccion titulo="Notas internas">
        <dl className="grid grid-cols-1 gap-3">
          {pedido.estado === "cancelado" && (
            <Dato label="Motivo de la cancelación">
              <span className="whitespace-pre-wrap">{pedido.cancelacionMotivo}</span>
            </Dato>
          )}
          <Dato label="Último cambio de estado">
            {ultimoCambio ?? "Este pedido todavía no tuvo cambios de estado."}
          </Dato>
        </dl>
        <p className="mt-3 text-xs" style={{ color: "var(--ink-faint)" }}>
          El cliente no ve estas notas.
        </p>
      </Seccion>
    </div>
  )
}

function Total({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <div
      className={destacado ? "flex justify-between pt-1 font-semibold" : "flex justify-between"}
      style={{
        color: destacado ? "var(--ink)" : "var(--ink-soft)",
        borderTop: destacado ? "1px solid var(--border)" : undefined,
      }}
    >
      <dt>{label}</dt>
      <dd>{valor}</dd>
    </div>
  )
}
