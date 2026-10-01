import { Badge, Card, Stepper } from "@myd-org/ui";
import { PAGO_ESTADO_LABEL, type Order } from "@/data/orders";
import { estadoPedidoPill } from "@/lib/estado-pedido-pill";
import { fmtFecha, fmtPrecio } from "@/lib/format";
import { ocultarEstadoPago } from "@/lib/pago-estado-visible";
import { seguimientoPedido } from "@/lib/pedido-seguimiento";
import { PedidoContacto } from "@/components/PedidoContacto";
import type { ContactoPedidoVista } from "@/lib/contacto-pedido";
import { puedeCancelarPedido } from "@/lib/pedido-cancelable";
import { CuentaTransferencia } from "@/components/CuentaTransferencia";
import { cuentaDelPedido } from "@/lib/pedido-cuenta-vista";
import { TEXTO_PLAZO_COMPROBANTE, puedeSubirComprobante } from "@/lib/comprobantes/pedido";
import { AvisoComprobante } from "./AvisoComprobante";
import { InformarPagoPedido } from "./InformarPagoPedido";
import { CancelarPedido } from "./CancelarPedido";
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
 * tuvo costo. Un pedido pendiente, sin pagar ni facturar, se puede cancelar.
 */
export function PedidoDetalle({
  pedido,
  medioPago,
  contacto,
}: {
  pedido: Order;
  /** Medio del CRM que eligió el comprador (nombre e instrucciones). */
  medioPago?: { nombre: string; instrucciones: string | null };
  /** Plazo de contacto y WhatsApp de la sucursal asignada. */
  contacto?: ContactoPedidoVista;
}) {
  const pill = estadoPedidoPill(pedido);
  const pasos = seguimientoPedido(pedido);
  // "Pago pendiente" sólo se muestra en un pedido que se cobra en línea (Mercado Pago).
  const verEstadoPago = !ocultarEstadoPago(pedido.pagoEstado, pedido.pagoMetodoSlug);
  // Transferencia pendiente: la cuenta congelada al pedir (sin snapshot, el mensaje neutro).
  const cuentaVisible = cuentaDelPedido(pedido);

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
          <p className="text-sm text-muted">{medioPago?.nombre ?? pedido.metodoPago}</p>
          {medioPago?.instrucciones && pedido.estado === "pendiente" && (
            <p className="mt-1 whitespace-pre-line text-sm text-text">{medioPago.instrucciones}</p>
          )}
          {verEstadoPago && <p className="mt-1 text-sm text-text">{PAGO_ESTADO_LABEL[pedido.pagoEstado]}</p>}
          {cuentaVisible.mostrar && (
            <CuentaTransferencia cuenta={cuentaVisible.cuenta} importe={cuentaVisible.cuenta ? pedido.total : undefined} className="mt-3" />
          )}
          {puedeSubirComprobante(pedido) && (
            <div id="comprobante" className="mt-3 scroll-mt-24">
              {pedido.comprobanteInformado && (
                <div className="mb-3">
                  <AvisoComprobante aviso="en_revision" pedidoId={pedido.id} conEnlace={false} />
                </div>
              )}
              <p className="mb-2 text-sm text-muted">{TEXTO_PLAZO_COMPROBANTE}</p>
              <InformarPagoPedido pedido={{ id: pedido.id, numero: pedido.numero, total: pedido.total }} />
            </div>
          )}
        </Card>
      </div>

      {contacto && (pedido.estado === "pendiente" || contacto.whatsapp) && (
        <Card title="Contacto">
          <PedidoContacto contacto={contacto} mostrarPlazo={pedido.estado === "pendiente"} />
        </Card>
      )}

      <Card title="Productos">
        <ul className="flex flex-col gap-3">
          {pedido.items.map((item) => (
            <PedidoLinea key={item.id} item={item} detalle />
          ))}
        </ul>
        <dl className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm">
          <Fila label="Subtotal" valor={fmtPrecio(pedido.subtotal)} />
          <Fila label="Impuestos" valor={fmtPrecio(pedido.iva)} />
          {pedido.costoEnvio > 0 && <Fila label="Envío" valor={fmtPrecio(pedido.costoEnvio)} />}
          <Fila label="Total" valor={fmtPrecio(pedido.total)} fuerte />
        </dl>
      </Card>

      <PedidoAcciones
        pedidoId={pedido.id}
        items={pedido.items}
        facturaId={pedido.facturaId}
        facturaNumero={pedido.facturaNumero}
        mostrarDetalle={false}
      />

      {puedeCancelarPedido(pedido) && (
        <div>
          <CancelarPedido pedidoId={pedido.id} numero={pedido.numero} />
        </div>
      )}
    </div>
  );
}
