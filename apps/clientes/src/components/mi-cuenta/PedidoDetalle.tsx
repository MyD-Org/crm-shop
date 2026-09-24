import { Badge, Card, Stepper } from "@myd-org/ui";
import { PAGO_ESTADO_LABEL, type Order } from "@/data/orders";
import { estadoPedidoPill } from "@/lib/estado-pedido-pill";
import { fmtFecha, fmtPrecio } from "@/lib/format";
import { ocultarEstadoPago } from "@/lib/pago-estado-visible";
import { seguimientoPedido } from "@/lib/pedido-seguimiento";
import { PedidoAcciones } from "./PedidoAcciones";
import { PedidoLinea } from "./PedidoLinea";

function Fila({ label, valor, fuerte = false }: { label: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={fuerte ? "font-semibold text-text" : "text-muted"}>{label}</dt>
      <dd className={fuerte ? "text-base font-semibold text-text" : "font-medium text-text"}>{valor}</dd>
    </div>
  );
}

/**
 * Detalle de un pedido: cabecera con una pill, seguimiento (salvo cancelado),
 * entrega, pago, productos con unitario y totales. El envío sólo aparece si
 * tuvo costo. Sin acción de cancelar (sigue en el checkout).
 */
export function PedidoDetalle({ pedido, pagosHabilitados }: { pedido: Order; pagosHabilitados: boolean }) {
  const pill = estadoPedidoPill(pedido, { pagosHabilitados });
  const pasos = seguimientoPedido(pedido, { pagosHabilitados });
  // Con los pagos apagados "Pago pendiente" no se muestra: se coordina por fuera.
  const verEstadoPago = !ocultarEstadoPago(pedido.pagoEstado, pagosHabilitados);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-medium tracking-tight text-text">Pedido {pedido.numero}</h2>
          <p className="mt-1 text-sm text-muted">{fmtFecha(pedido.fecha)}</p>
        </div>
        <Badge tone={pill.tone}>{pill.label}</Badge>
      </div>

      {pasos && <Stepper ariaLabel={`Seguimiento del pedido ${pedido.numero}`} steps={pasos} size="md" />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Entrega">
          <p className="text-sm text-muted">{pedido.metodoEntrega}</p>
          {pedido.entregaDireccion && (
            <p className="mt-1 text-sm text-text">
              {pedido.entregaDireccion}
              {pedido.entregaCiudad ? `, ${pedido.entregaCiudad}` : ""}
            </p>
          )}
        </Card>
        <Card title="Pago">
          <p className="text-sm text-muted">{pedido.metodoPago}</p>
          {verEstadoPago && <p className="mt-1 text-sm text-text">{PAGO_ESTADO_LABEL[pedido.pagoEstado]}</p>}
        </Card>
      </div>

      <Card title="Productos">
        <ul className="flex flex-col gap-3">
          {pedido.items.map((item) => (
            <PedidoLinea key={item.id} item={item} detalle />
          ))}
        </ul>
        <dl className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm">
          <Fila label="Subtotal" valor={fmtPrecio(pedido.subtotal)} />
          <Fila label="IVA" valor={fmtPrecio(pedido.iva)} />
          {pedido.costoEnvio > 0 && <Fila label="Envío" valor={fmtPrecio(pedido.costoEnvio)} />}
          <Fila label="Total" valor={fmtPrecio(pedido.total)} fuerte />
        </dl>
      </Card>

      <PedidoAcciones pedidoId={pedido.id} items={pedido.items} facturaId={pedido.facturaId} mostrarDetalle={false} />
    </div>
  );
}
