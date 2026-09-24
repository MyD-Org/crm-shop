import { Badge, Card, Divider, Stepper } from "@myd-org/ui";
import type { Order } from "@/data/orders";
import { estadoPedidoPill } from "@/lib/estado-pedido-pill";
import { fmtFecha, fmtPrecio } from "@/lib/format";
import { seguimientoPedido } from "@/lib/pedido-seguimiento";
import { etiquetaUnidades, unidadesPedido } from "@/lib/pedido-vista";
import { PedidoAcciones } from "./PedidoAcciones";
import { PedidoLinea } from "./PedidoLinea";

/**
 * Card de un pedido en el resumen y en la lista: una sola pill de estado, el
 * seguimiento (salvo cancelado), las líneas con su nombre real, el pie con
 * entrega, pago y total, y las acciones. Server-safe: pill y pasos son
 * proyecciones puras del pedido.
 */
export function PedidoCard({ pedido, pagosHabilitados }: { pedido: Order; pagosHabilitados: boolean }) {
  const pill = estadoPedidoPill(pedido, { pagosHabilitados });
  const pasos = seguimientoPedido(pedido, { pagosHabilitados });
  const unidades = unidadesPedido(pedido.items);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-text">Pedido {pedido.numero}</h3>
          <p className="text-sm text-muted">
            {fmtFecha(pedido.fecha)} · {etiquetaUnidades(unidades)}
          </p>
        </div>
        <Badge tone={pill.tone}>{pill.label}</Badge>
      </div>

      {pasos && (
        <div className="mt-5">
          <Stepper ariaLabel={`Seguimiento del pedido ${pedido.numero}`} steps={pasos} size="sm" />
        </div>
      )}

      <Divider className="my-4" />

      <ul className="grid gap-3 md:grid-cols-2">
        {pedido.items.map((item) => (
          <PedidoLinea key={item.id} item={item} />
        ))}
      </ul>

      <Divider className="my-4" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {pedido.metodoEntrega} · {pedido.metodoPago}
          {pedido.entregaTipo === "envio" && pedido.entregaDireccion
            ? ` · ${pedido.entregaDireccion}${pedido.entregaCiudad ? `, ${pedido.entregaCiudad}` : ""}`
            : ""}
        </p>
        <p className="text-sm text-text">
          <span className="text-base font-semibold">{fmtPrecio(pedido.total)}</span>{" "}
          <span className="text-xs text-muted">IVA incl.</span>
        </p>
      </div>

      <div className="mt-4">
        <PedidoAcciones pedidoId={pedido.id} items={pedido.items} facturaId={pedido.facturaId} />
      </div>
    </Card>
  );
}
