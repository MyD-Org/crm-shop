import { Badge, Card, Divider, Stepper } from "@myd-org/ui";
import type { Order } from "@/data/orders";
import { puedeReintentarPago } from "@/lib/pago-estado-visible";
import { estadoPedidoPill } from "@/lib/estado-pedido-pill";
import { fmtFecha, fmtPrecio } from "@/lib/format";
import { seguimientoPedido } from "@/lib/pedido-seguimiento";
import { avisoComprobante } from "@/lib/comprobantes/aviso-card";
import { AvisoComprobante } from "./AvisoComprobante";
import { PedidoAcciones } from "./PedidoAcciones";
import { PedidoLinea } from "./PedidoLinea";

/**
 * Card de un pedido en el resumen y en la lista: una sola pill de estado, el
 * seguimiento (salvo cancelado), las líneas con su nombre real, el pie con
 * entrega, pago y total, y las acciones. Server-safe: pill y pasos son
 * proyecciones puras del pedido.
 */
export function PedidoCard({ pedido }: { pedido: Order }) {
  const pill = estadoPedidoPill(pedido);
  const pasos = seguimientoPedido(pedido);
  const aviso = avisoComprobante(pedido);

  return (
    <Card>
      <h3 className="text-base font-semibold text-text">Pedido {pedido.numero}</h3>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{fmtFecha(pedido.fecha)}</p>
        <Badge tone={pill.tone}>{pill.label}</Badge>
      </div>

      {pedido.pagoEnProceso && pedido.estado === "pendiente" && pedido.pagoEstado === "pendiente" && (
        <p className="mt-2 text-sm text-muted">
          Estamos confirmando su pago. Le enviaremos un correo cuando se resuelva.
        </p>
      )}

      {pasos && (
        <div className="mt-5">
          <Stepper ariaLabel={`Seguimiento del pedido ${pedido.numero}`} steps={pasos} size="sm" />
        </div>
      )}

      {aviso && (
        <div className="mt-4">
          <AvisoComprobante aviso={aviso} pedidoId={pedido.id} />
        </div>
      )}

      <Divider className="my-4" />

      {/* grid-cols-1 explícito: la columna implícita crece con el nombre más
          largo y el truncate de la línea no corta (la página se corría de costado). */}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
          <span className="text-xs text-muted">Impuestos incl.</span>
        </p>
      </div>

      <div className="mt-4">
        <PedidoAcciones
          pedidoId={pedido.id}
          items={pedido.items}
          facturaId={pedido.facturaId}
          facturaNumero={pedido.facturaNumero}
          reintentarPago={puedeReintentarPago(pedido)}
        />
      </div>
    </Card>
  );
}
