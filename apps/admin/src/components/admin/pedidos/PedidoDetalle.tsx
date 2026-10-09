"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Alert, Badge, Button, Card, Dialog, Field, Select, Stepper, Table, Textarea, type StepItem, type TableColumn, useToast } from "@myd-org/ui"
import type { PedidoDetalleDto, PedidoItemDto } from "@/lib/pedidos-repo"
import { reglaATexto, whatsappLink, type NombresSucursal } from "@/lib/sucursales-texto"
import { ESTADO_PEDIDO_LABEL, MOTIVO_MAX, type EntregaTipo, type EstadoPedido } from "@/lib/pedidos-transiciones"
import { AlertaCobroOtraCuenta } from "./AlertaCobroOtraCuenta"
import { CuentaFacturaInfo } from "./CuentaFacturaInfo"
import { ContactoControl } from "./ContactoControl"
import { EmitirFacturaControl } from "./EmitirFacturaControl"
import { ReservaControl } from "./ReservaControl"
import { PagosComprobantes } from "./PagosComprobantes"
import { RegistrarPagoControl } from "./RegistrarPagoControl"
import { RemitoControl } from "./RemitoControl"
import { VincularFacturaControl } from "./VincularFacturaControl"
import { MotivosFrecuentes } from "./MotivosFrecuentes"
import { AVISO_SIN_FACTURA, useCambiarEstado } from "./useCambiarEstado"
import { avisoDevolucion, ofreceCancelar, opcionesOtroEstado, pasosPedido, siguientePaso, verboSiguientePaso } from "./logica"
import {
  PAGO_REVISION_INFO,
  condicionIvaLabel,
  datosCobroEnLinea,
  entregaLabel,
  fmtCantidad,
  fmtFechaPedido,
  fmtMoneda,
  pagoEstadoLabel,
  pagoMetodoLabel,
  revisionInfo,
  textoEvento,
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

function SubTitulo({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>
      {children}
    </h3>
  )
}

/**
 * Resumen del pago. Con cobro en línea: "Pagó con", cuotas y fecha a la vista, los dos importes
 * destacados y el resto de `datosCobroEnLinea` detrás de "Ver detalle del cobro". Sin cobro en
 * línea: medio y estado como siempre.
 */
function ResumenPago({
  pedido,
  medioNombre,
  nombresSucursal,
}: {
  pedido: PedidoDetalleDto
  medioNombre: string
  nombresSucursal: NombresSucursal
}) {
  const [abierto, setAbierto] = useState(false)
  const pago = pedido.pagoEnLinea
  if (!pago) {
    return (
      <dl className="mb-2 flex flex-col gap-1">
        <Dato label="Medio de pago">{medioNombre}</Dato>
      </dl>
    )
  }
  const datos = datosCobroEnLinea(pago, pedido.total, nombresSucursal)
  const RESUMEN = ["Pagó con", "Cuotas", "Fecha del pago"]
  const resumen = datos.filter((d) => RESUMEN.includes(d.label))
  const neto = datos.find((d) => d.label === "Recibe neto")
  const detalle = datos.filter((d) => !RESUMEN.includes(d.label) && d.label !== "Recibe neto")
  return (
    <div className="mb-2 flex flex-col gap-3">
      <dl className="flex flex-col gap-1">
        <Dato label="Medio de pago">{medioNombre}</Dato>
        {resumen.map((d) => (
          <Dato key={d.label} label={d.label}>{d.valor}</Dato>
        ))}
      </dl>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="text-xs" style={{ color: "var(--ink-faint)" }}>Cobrado</div>
          <div className="text-base font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
            {fmtMoneda(pago.totalPagado ?? pedido.total)}
          </div>
        </div>
        {neto && (
          <div className="min-w-0">
            <div className="text-xs" style={{ color: "var(--ink-faint)" }}>{neto.label}</div>
            <div className="text-base font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{neto.valor}</div>
          </div>
        )}
      </div>
      {detalle.length > 0 && (
        <>
          <Button
            variant="link"
            size="sm"
            className="self-start"
            aria-expanded={abierto}
            onClick={() => setAbierto((v) => !v)}
          >
            {abierto ? "Ocultar detalle" : "Ver detalle del cobro"}
          </Button>
          {abierto && (
            <dl className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: "var(--border)" }}>
              {detalle.map((d) => (
                <div key={d.label} className="flex justify-between gap-3 text-sm">
                  <dt style={{ color: "var(--ink-soft)" }}>{d.label}</dt>
                  <dd className="text-right break-words" style={{ color: "var(--ink)" }}>{d.valor}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
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

export function PedidoDetalle({
  initial,
  esAdminPlus,
  nombresSucursal = {},
  mediosPago = {},
  whatsappsSucursal = {},
}: {
  initial: PedidoDetalleDto
  esAdminPlus: boolean
  /** `slug -> nombre` de las sucursales del tenant, para mostrar la asignada con su nombre. */
  nombresSucursal?: NombresSucursal
  /** `slug -> nombre` de los medios de pago del checkout (`medios_pago_shop`); un slug que no está
   *  cae a las etiquetas de siempre y, si tampoco, al texto crudo. */
  mediosPago?: Record<string, string>
  /** `slug de sucursal -> WhatsApp` para el enlace de contacto de la sucursal asignada. */
  whatsappsSucursal?: Record<string, string>
}) {
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
  // Envío sin ciudad ni dirección: el Shop lo ofrece como "Envío a coordinar" (lo acuerda un asesor).
  const envioACoordinar = esEnvio && !pedido.entrega.ciudad?.trim() && !pedido.entrega.direccion?.trim()
  const sinStock = pedido.items.filter((i) => i.stockActual !== null && i.stockActual < i.qty)
  const lineasATraer = pedido.items.filter((i) => i.aTraerDe)
  const whatsappRaw = pedido.sucursal ? whatsappsSucursal[pedido.sucursal] : undefined
  const whatsappHref = whatsappLink(whatsappRaw)
  const whatsappSucursal = whatsappHref && whatsappRaw ? { href: whatsappHref, texto: whatsappRaw.trim() } : null
  const revision = pedido.requiereRevision
    ? revisionInfo({
        motivo: pedido.motivoRevision,
        condicionIva: pedido.facturacion.condicionIva,
        tipoDoc: pedido.facturacion.tipoDoc,
        nroDoc: pedido.facturacion.nroDoc,
        listaPrecios: pedido.revisionListaPrecios,
        sucursalContacto: pedido.revisionSucursalContacto,
      })
    : null

  const columns: TableColumn<PedidoItemDto>[] = [
    {
      key: "producto",
      header: "Producto",
      render: (i) => (
        <>
          <div className="font-medium" style={{ color: "var(--ink)" }}>{i.name}</div>
          {i.aTraerDe && (
            <div className="text-xs font-medium" style={{ color: "var(--amber)" }}>
              A traer de {nombresSucursal[i.aTraerDe] ?? i.aTraerDe}
            </div>
          )}
          {(i.code || i.brand) && (
            <div className="text-xs" style={{ color: "var(--ink-faint)" }}>
              {[i.code, i.brand].filter(Boolean).join(" · ")}
            </div>
          )}
          <DatosDelLocal item={i} esAdminPlus={esAdminPlus} />
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
          {pedido.factura && <Badge tone="success">Facturado</Badge>}
          {revision && (
            <span title={revision.titulo}>
              <Badge tone="warning">Revisar</Badge>
            </span>
          )}
          {pedido.pagoRevision && (
            <Badge tone="danger">{PAGO_REVISION_INFO[pedido.pagoRevision].label}</Badge>
          )}
        </div>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Realizado el {fmtFechaPedido(pedido.creadoEn)} · {pedido.items.length} {pedido.items.length === 1 ? "producto" : "productos"} · {fmtMoneda(pedido.total)}
        </p>
      </div>

      {sinStock.length > 0 && (
        <Alert tone="warning" title={`Falta stock en ${sinStock.length} ${sinStock.length === 1 ? "producto" : "productos"}.`}>
          <ul className="flex flex-col gap-0.5">
            {sinStock.map((i) => (
              <li key={i.id}>
                {i.name}: se {i.qty === 1 ? "pide" : "piden"} {fmtCantidad(i.qty)} y hay {fmtCantidad(i.stockActual ?? 0)}.
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {revision && (
        <Alert tone="warning" title={revision.titulo}>
          {/* Lo marca el Shop con el motivo más importante (`motivo_revision`). */}
          {revision.detalle}
        </Alert>
      )}
      {pedido.pagoRevision && (
        <Alert tone="danger" title={PAGO_REVISION_INFO[pedido.pagoRevision].label}>
          {PAGO_REVISION_INFO[pedido.pagoRevision].detalle}
        </Alert>
      )}

      {/* Grid principal + columna de acciones. En mobile, las acciones van PRIMERO (order-first)
          y la columna deja de ser sticky (position: static por el propio flujo de la grilla). */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="order-2 flex flex-col gap-4 lg:order-1">
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

          <Seccion titulo="Cliente, facturación y entrega">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="min-w-0">
                <SubTitulo>Cliente</SubTitulo>
                <dl className="flex flex-col gap-3">
                  <Dato label="Nombre">{pedido.contacto.nombre}</Dato>
                  <Dato label="Teléfono">{pedido.contacto.telefono}</Dato>
                  <Dato label="Email">{pedido.cliente.email}</Dato>
                  <Dato label="Cliente">
                    {[pedido.cliente.razonSocial, pedido.cliente.codigo && `Cód. ${pedido.cliente.codigo}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </Dato>
                </dl>
              </div>
              <div className="min-w-0">
                <SubTitulo>Facturación</SubTitulo>
                <dl className="flex flex-col gap-3">
                  <Dato label="Razón social (facturación)">{pedido.facturacion.razonSocial}</Dato>
                  <Dato label="Documento">{documento}</Dato>
                  <Dato label="Condición de IVA">{condicionIvaLabel(pedido.facturacion.condicionIva)}</Dato>
                  <Dato label="Domicilio">{pedido.facturacion.domicilio}</Dato>
                </dl>
              </div>
              <div className="min-w-0">
                <SubTitulo>Entrega</SubTitulo>
                {lineasATraer.length > 0 && (
                  <div className="mb-3">
                    <Alert tone="warning" title="Hay productos a traer de otra sucursal">
                      {lineasATraer.length === 1 ? "Un producto de este pedido no sale" : `${lineasATraer.length} productos de este pedido no salen`}{" "}
                      de la sucursal que despacha: hay que trasladarlos antes de entregar.
                    </Alert>
                  </div>
                )}
                <dl className="flex flex-col gap-3">
                  <Dato label="Tipo">{envioACoordinar ? "Envío a coordinar" : entregaLabel(pedido.entrega.tipo)}</Dato>
                  {esEnvio && (pedido.envioGratis !== null || envioACoordinar) && (
                    <Dato label="Costo de envío">{pedido.envioGratis ? "Gratis" : "A coordinar con el cliente"}</Dato>
                  )}
                  {((esEnvio && !envioACoordinar) || pedido.entrega.ciudad) && <Dato label="Ciudad">{pedido.entrega.ciudad}</Dato>}
                  {((esEnvio && !envioACoordinar) || pedido.entrega.direccion) && <Dato label="Dirección">{pedido.entrega.direccion}</Dato>}
                  <Dato label="Sucursal">{reglaATexto(pedido.sucursal, pedido.sucursalRegla, nombresSucursal)}</Dato>
                  {whatsappSucursal && (
                    <Dato label="WhatsApp de la sucursal">
                      <a href={whatsappSucursal.href} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--blue)" }}>
                        {whatsappSucursal.texto}
                      </a>
                    </Dato>
                  )}
                </dl>
              </div>
            </div>
            <div className="mt-4 rounded-md p-3" style={{ background: "var(--bg)" }}>
              <div className="text-xs" style={{ color: "var(--ink-faint)" }}>Aclaraciones del cliente</div>
              <p className="text-sm whitespace-pre-wrap break-words" style={{ color: pedido.notas ? "var(--ink)" : "var(--ink-faint)" }}>
                {pedido.notas || "El cliente no dejó aclaraciones."}
              </p>
            </div>
          </Seccion>

          <PagosComprobantes
            pedidoId={pedido.id}
            cuentaPago={pedido.cuentaPago}
            comprobantes={pedido.comprobantes}
            pagos={pedido.pagos}
            esAdminPlus={esAdminPlus}
            onChanged={() => void recargar(false)}
          />

          <Seccion titulo="Actividad y notas">
            <dl className="mb-3 grid grid-cols-1 gap-3">
              {pedido.estado === "cancelado" && (
                <Dato label="Motivo de la cancelación">
                  <span className="whitespace-pre-wrap">{pedido.cancelacionMotivo}</span>
                </Dato>
              )}
              <Dato label="Último cambio de estado">
                {ultimoCambio ?? "Este pedido todavía no tuvo cambios de estado."}
              </Dato>
            </dl>
            {pedido.historial.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--ink-faint)" }}>Este pedido todavía no tiene movimientos.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {pedido.historial.map((evento, i) => (
                  <li key={i} className="grid grid-cols-1 gap-0.5 text-sm sm:grid-cols-[150px_1fr] sm:gap-3">
                    <span className="tabular-nums" style={{ color: "var(--ink-faint)" }}>{fmtFechaPedido(evento.en)}</span>
                    <span style={{ color: "var(--ink)" }}>{textoEvento(evento)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs" style={{ color: "var(--ink-faint)" }}>El cliente no ve esta sección.</p>
          </Seccion>
        </div>

        {/* Acciones: sticky en desktop, primero en mobile (ver order-* arriba). */}
        <aside className="order-1 flex flex-col gap-4 lg:sticky lg:top-4 lg:order-2">
          <Card title="Estado" className="p-4">
            <ContactoControl pedidoId={pedido.id} estado={pedido.estado} creadoEn={pedido.creadoEn} />
            <ReservaControl
              pedido={pedido}
              esAdminPlus={esAdminPlus}
              onChanged={(venceEn) => setPedido((p) => ({ ...p, reserva: { venceEn } }))}
            />
            <EstadoAcciones key={pedido.estado} esAdminPlus={esAdminPlus} pedido={pedido} onChanged={setPedido} onConflicto={() => void recargar(true)} />
          </Card>

          <Card title="Pago" className="p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: "var(--ink-faint)" }}>Estado del pago</span>
              <Badge tone={pedido.pagoEstado === "pagado" ? "success" : "warning"}>{pagoEstadoLabel(pedido.pagoEstado)}</Badge>
            </div>
            <AlertaCobroOtraCuenta pago={pedido.pagoEnLinea} nombresSucursal={nombresSucursal} />
            <ResumenPago
              pedido={pedido}
              medioNombre={Object.hasOwn(mediosPago, pedido.pagoMetodo) ? mediosPago[pedido.pagoMetodo] : pagoMetodoLabel(pedido.pagoMetodo)}
              nombresSucursal={nombresSucursal}
            />
            {pedido.pagoManual && pedido.pagoRegistradoPorNombre && (
              <dl className="mb-2">
                <Dato label={pedido.pagoEstado === "pagado" ? "Pago registrado" : "Pago anulado"}>
                  {textoUltimoCambio(pedido.pagoRegistradoPorNombre, pedido.pagoActualizadoEn)}
                </Dato>
              </dl>
            )}
            <RegistrarPagoControl pedido={pedido} onChanged={setPedido} />
          </Card>

          <Card title="Factura y remito" className="p-4">
            <div className="flex flex-col gap-4">
              <div>
                <SubTitulo>Factura</SubTitulo>
                <CuentaFacturaInfo pedido={pedido} />
                {pedido.emisionReserva === "vigente" ? (
                  <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                    Emisión en curso… Actualice la página en unos segundos.
                  </p>
                ) : (
                  <>
                    {pedido.emisionReserva === "vencida" && (
                      <Alert tone="warning" title="Una emisión anterior no terminó">
                        Revise en Alegra si la factura se creó antes de volver a emitir. Si existe, use &ldquo;Vincular
                        factura&rdquo;.
                      </Alert>
                    )}
                    <VincularFacturaControl pedido={pedido} onChanged={setPedido} onConflicto={() => void recargar(true)} />
                    {!pedido.factura && pedido.estado !== "cancelado" && (
                      <EmitirFacturaControl
                        pedido={pedido}
                        onChanged={setPedido}
                        onConflicto={() => void recargar(true)}
                        esAdminPlus={esAdminPlus}
                      />
                    )}
                  </>
                )}
              </div>
              {esAdminPlus && (
                <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
                  <SubTitulo>Remito</SubTitulo>
                  <RemitoControl
                    pedido={pedido}
                    onChanged={setPedido}
                    onConflicto={() => void recargar(true)}
                    esAdminPlus={esAdminPlus}
                  />
                </div>
              )}
            </div>
          </Card>
        </aside>
      </div>
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

/**
 * Bloque de acciones de estado: Stepper del camino feliz, botón primario para el siguiente paso
 * y un Select con el resto de los destinos (incluido "Cancelar pedido"). Usa el mismo
 * `useCambiarEstado` que `PedidosTablero`: el diálogo de motivo y el aviso de "entregado sin
 * factura" son un solo lugar para las dos pantallas.
 */
function EstadoAcciones({
  pedido,
  esAdminPlus,
  onChanged,
  onConflicto,
}: {
  pedido: PedidoDetalleDto
  esAdminPlus: boolean
  onChanged: (pedido: PedidoDetalleDto) => void
  onConflicto: () => void
}) {
  const entregaTipo: EntregaTipo = pedido.entrega.tipo === "retiro" ? "retiro" : "envio"
  // `key={pedido.estado}` en el padre reinicia este estado al cambiar de estado.
  const [otro, setOtro] = useState("")

  const {
    intencion,
    motivo,
    setMotivo,
    guardando,
    puedeCancelar,
    pedirCambio,
    confirmarCancelacion,
    confirmarSinFactura,
    pedirCancelacionForzada,
    confirmarCancelacionForzada,
    cerrar,
  } = useCambiarEstado<{ id: string; estado: EstadoPedido }>({
    onChanged: (p) => onChanged(p as unknown as PedidoDetalleDto),
    onConflicto,
  })

  if (pedido.estado === "cancelado") {
    return (
      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
        Cancelado{pedido.cancelacionMotivo ? `: ${pedido.cancelacionMotivo}` : ""}. No admite más cambios de estado.
      </p>
    )
  }

  const pasos = pasosPedido(entregaTipo)
  const idx = pasos.indexOf(pedido.estado)
  const steps: StepItem[] = pasos.map((e, i) => ({
    label: ESTADO_PEDIDO_LABEL[e],
    state: i < idx ? "done" : i === idx ? "current" : "pending",
  }))
  const siguiente = siguientePaso(pedido.estado, entregaTipo)
  const tieneFactura = pedido.factura !== null
  const otrosDestinos = opcionesOtroEstado(
    pedido.estado,
    entregaTipo,
    ofreceCancelar({
      pagoEstado: pedido.pagoEstado,
      facturado: tieneFactura || pedido.facturadoEn !== null,
      historial: pedido.historial,
    }),
  )

  function elegirOtro(valor: string) {
    setOtro(valor)
    if (valor) pedirCambio({ id: pedido.id, estado: pedido.estado }, valor as EstadoPedido, tieneFactura)
  }

  return (
    <div className="flex flex-col gap-3">
      <Stepper steps={steps} orientation="vertical" size="sm" ariaLabel="Seguimiento del pedido" />

      {siguiente && (
        <Button
          onClick={() => pedirCambio({ id: pedido.id, estado: pedido.estado }, siguiente, tieneFactura)}
          loading={guardando && intencion === null}
        >
          {verboSiguientePaso(siguiente, entregaTipo)}
        </Button>
      )}

      {otrosDestinos.length > 0 && (
        <Field label="Otro estado">
          <Select
            value={otro}
            onValueChange={elegirOtro}
            options={otrosDestinos}
            placeholder="Seleccione…"
            disabled={guardando}
          />
        </Field>
      )}

      {esAdminPlus && (
        <Button
          variant="ghost"
          onClick={() => pedirCancelacionForzada({ id: pedido.id, estado: pedido.estado })}
          disabled={guardando}
        >
          Cancelar con devolución
        </Button>
      )}

      <Dialog
        dismissible={false}
        open={intencion?.tipo === "forzado"}
        onOpenChange={(open) => { if (!open && !guardando) cerrar() }}
        title="Cancelar con devolución"
        description={
          `${avisoDevolucion({ pagoEstado: pedido.pagoEstado, pagoMetodo: pedido.pagoMetodo, facturado: tieneFactura || pedido.facturadoEn !== null })} ` +
          "Esta acción no se puede deshacer y queda registrada con su nombre. Indique el motivo."
        }
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={cerrar} disabled={guardando}>Volver</Button>
            <Button variant="danger" loading={guardando} disabled={!puedeCancelar} onClick={confirmarCancelacionForzada}>
              Cancelar con devolución
            </Button>
          </div>
        }
      >
        <Field label="Motivo" hint={`${motivo.length}/${MOTIVO_MAX}`}>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={4}
            maxLength={MOTIVO_MAX}
            required
            aria-required="true"
            disabled={guardando}
          />
        </Field>
      </Dialog>

      <Dialog
        dismissible={false}
        open={intencion?.tipo === "motivo"}
        onOpenChange={(open) => { if (!open && !guardando) cerrar() }}
        title="Cancelar pedido"
        description="Esta acción no se puede deshacer. Indique el motivo de la cancelación."
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={cerrar} disabled={guardando}>Volver</Button>
            <Button variant="danger" loading={guardando} disabled={!puedeCancelar} onClick={confirmarCancelacion}>
              Cancelar pedido
            </Button>
          </div>
        }
      >
        <Field label="Motivo" hint={`${motivo.length}/${MOTIVO_MAX}`}>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={4}
            maxLength={MOTIVO_MAX}
            required
            aria-required="true"
            disabled={guardando}
          />
        </Field>
        <MotivosFrecuentes onElegir={(m) => setMotivo(m.slice(0, MOTIVO_MAX))} disabled={guardando} />
      </Dialog>

      <Dialog
        open={intencion?.tipo === "sinFactura"}
        onOpenChange={(open) => { if (!open && !guardando) cerrar() }}
        title="Marcar como entregado"
        description={AVISO_SIN_FACTURA}
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={cerrar} disabled={guardando}>Volver</Button>
            <Button loading={guardando} onClick={confirmarSinFactura}>Continuar</Button>
          </div>
        }
      />
    </div>
  )
}

// Stock y costo son datos del local, no de lo que pidió el cliente: van en una línea aparte debajo
// del producto, chica y en gris, para que no se lean como columnas del pedido.
// Stock ACTUAL del espejo del catálogo, no el del momento del pedido; sin dato (producto fuera del
// espejo) muestra una raya: que falte se tiene que notar.
// Costo unitario cargado en Alegra: SÓLO admin+. El DTO no trae el campo para operator (ver
// `canSeeCosts`), así que se oculta por rol y no por "vino null".
function DatosDelLocal({ item, esAdminPlus }: { item: PedidoItemDto; esAdminPlus: boolean }) {
  const falta = item.stockActual !== null && item.stockActual < item.qty ? item.qty - item.stockActual : 0
  return (
    <div className="mt-1 text-xs tabular-nums" style={{ color: "var(--ink-faint)" }}>
      <span style={falta > 0 ? { color: "var(--red)" } : undefined}>
        Stock {item.stockActual === null ? "—" : fmtCantidad(item.stockActual)}
        {falta > 0 && ` (falta ${fmtCantidad(falta)})`}
      </span>
      {esAdminPlus && (
        <> · Costo {item.costoUnitario == null ? "—" : fmtMoneda(item.costoUnitario)}</>
      )}
    </div>
  )
}
