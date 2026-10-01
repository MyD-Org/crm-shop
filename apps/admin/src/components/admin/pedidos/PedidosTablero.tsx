"use client"

// Vista "Tablero" de Pedidos: un `Board` (kanban) de @myd-org/ui con una columna por estado del
// camino feliz (sin "Cancelado": ese pedido no aparece en `vista=tablero`, ver pedidos-repo.ts).
// El arrastre nativo del `Board` y el "Mover a…" de cada tarjeta llaman al MISMO
// `useCambiarEstado` que usa `CambiarEstadoControl` en el detalle, así que el motivo de
// cancelación y el aviso de "entregado sin factura" son un solo lugar para las dos pantallas.

import Link from "next/link"
import { Badge, Board, Button, Dialog, DropdownMenu, Field, Textarea, type BoardColumn, type DropdownMenuEntry } from "@myd-org/ui"
import type { PedidoListaDto } from "@/lib/pedidos-repo"
import { ESTADO_PEDIDO_LABEL, MOTIVO_MAX, puedeTransicionar, type EntregaTipo, type EstadoPedido } from "@/lib/pedidos-transiciones"
import { esSinFactura, ofreceCancelar, opcionesDeDestino, type OpcionSelect } from "./logica"
import { PAGO_REVISION_INFO, entregaLabel, fmtFechaRelativa, fmtMoneda, tituloRevision } from "./format"
import { MotivosFrecuentes } from "./MotivosFrecuentes"
import { AVISO_SIN_FACTURA, useCambiarEstado } from "./useCambiarEstado"

/** Columnas del tablero: los 5 pasos del camino feliz. "Entregado" ya viene acotado a los
 *  últimos 7 días por el servidor (`vista=tablero`); acá sólo se rotula. */
const COLUMNAS: BoardColumn[] = (["pendiente", "confirmado", "preparacion", "en_camino", "entregado"] as const).map(
  (estado) => ({
    id: estado,
    title: estado === "entregado" ? `${ESTADO_PEDIDO_LABEL[estado]} · 7 días` : ESTADO_PEDIDO_LABEL[estado],
  }),
)

interface Props {
  items: PedidoListaDto[]
  /** Se llama después de un cambio (éxito o 409): quien lo use debe volver a pedir la lista. */
  onRecargar: () => void
}

export function PedidosTablero({ items, onRecargar }: Props) {
  const {
    intencion,
    motivo,
    setMotivo,
    guardando,
    puedeCancelar,
    pedirCambio,
    confirmarCancelacion,
    confirmarSinFactura,
    cerrar,
  } = useCambiarEstado<PedidoListaDto>({ onChanged: onRecargar, onConflicto: onRecargar })

  return (
    <div className="flex flex-col gap-2">
      <Board<PedidoListaDto>
        columns={COLUMNAS}
        items={items}
        getColumnId={(p) => p.estado}
        getItemId={(p) => p.id}
        canDrop={(p, toColumnId) => puedeTransicionar(p.estado, toColumnId as EstadoPedido, p.entregaTipo as EntregaTipo)}
        onMove={(p, toColumnId) => pedirCambio(p, toColumnId as EstadoPedido, p.facturado)}
        empty={<span>Sin pedidos</span>}
        renderCard={(p) => (
          <Tarjeta pedido={p} onElegir={(destino) => pedirCambio(p, destino, p.facturado)} />
        )}
      />
      <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
        Arrastre una tarjeta a otra columna o use «Mover a…». Sólo se permiten los cambios válidos para el tipo de entrega.
      </p>

      <Dialog
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

function opcionesMenu(opciones: OpcionSelect[], onElegir: (destino: EstadoPedido) => void): DropdownMenuEntry[] {
  return opciones.map((o) => ({ label: o.label, onSelect: () => onElegir(o.value as EstadoPedido) }))
}

function Tarjeta({ pedido: p, onElegir }: { pedido: PedidoListaDto; onElegir: (destino: EstadoPedido) => void }) {
  const opciones = opcionesDeDestino(
    p.estado,
    p.entregaTipo as EntregaTipo,
    ofreceCancelar({ pagoEstado: p.pagoEstado, facturado: p.facturado }),
  )
  return (
    <article className="flex flex-col gap-1.5 rounded-lg border p-2.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-baseline justify-between gap-2">
        <Link href={`/admin/pedidos/${p.id}`} className="font-medium tabular-nums hover:underline" style={{ color: "var(--ink)" }}>
          {p.numero}
        </Link>
        <span className="text-xs" style={{ color: "var(--ink-faint)" }}>{fmtFechaRelativa(p.creadoEn)}</span>
      </div>
      <div className="truncate" style={{ color: "var(--ink)" }}>{p.contactoNombre}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{fmtMoneda(p.total)}</span>
        <span className="text-xs" style={{ color: "var(--ink-soft)" }}>{entregaLabel(p.entregaTipo)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone={p.pagoEstado === "pagado" ? "success" : "warning"}>
          {p.pagoEstado === "pagado" ? "Pagado" : "Pago pendiente"}
        </Badge>
        {p.requiereRevision && (
          <span title={tituloRevision(p.motivoRevision)}><Badge tone="warning">Revisar</Badge></span>
        )}
        {p.pagoRevision && <Badge tone="danger">{PAGO_REVISION_INFO[p.pagoRevision].label}</Badge>}
        {esSinFactura(p) && <Badge tone="neutral">Sin factura</Badge>}
      </div>
      {opciones.length > 0 && (
        <DropdownMenu items={opcionesMenu(opciones, onElegir)} align="start">
          <button
            type="button"
            className="mt-0.5 w-full rounded-md border px-2 py-1 text-left text-xs"
            style={{ borderColor: "var(--border)", color: "var(--ink-soft)" }}
            aria-label={`Mover ${p.numero} a otro estado`}
          >
            Mover a…
          </button>
        </DropdownMenu>
      )}
    </article>
  )
}
