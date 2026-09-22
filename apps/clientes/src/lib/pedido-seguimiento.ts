/**
 * Seguimiento de un pedido como proyección de su estado: los datos del
 * `Stepper` del DS. Módulo puro.
 *
 * Pasos por tipo de entrega:
 * - retiro: Pedido recibido → Pago confirmado → Preparando → Retirado
 * - envío:  Pedido recibido → Pago confirmado → Preparando → En camino → Entregado
 *
 * Un paso está hecho según el estado del pedido; el primero no hecho es el
 * actual y los siguientes quedan pendientes. "Pago confirmado" también se da
 * por hecho cuando el operador ya confirmó el pedido: el cobro puede haber
 * sido offline (en el local, transferencia). Un pago fallido no mueve el
 * seguimiento: lo comunica la pill (`estado-pedido-pill.ts`). Un pedido
 * cancelado no tiene seguimiento.
 *
 * "Listo para retiro" NO existe: el CRM no tiene ese estado (CHECK
 * `orders_estado_check`). Un retiro se ve "Preparando" hasta que el local lo
 * marca entregado. Cuando el follow-up `pedidos-listo-retiro` agregue el
 * estado, se inserta el paso en `PASOS` y el componente no cambia.
 */
import type { StepState } from "@myd-org/ui";
import type { EntregaTipoPedido, Order, OrderEstado } from "@/data/orders";

export type IdPasoSeguimiento =
  | "recibido"
  | "pago"
  | "preparando"
  | "en_camino"
  | "entregado"
  | "retirado";

export interface PasoSeguimiento {
  id: IdPasoSeguimiento;
  label: string;
  state: StepState;
}

type Pedido = Pick<Order, "estado" | "pagoEstado" | "entregaTipo">;

const PASOS: Record<EntregaTipoPedido, readonly IdPasoSeguimiento[]> = {
  retiro: ["recibido", "pago", "preparando", "retirado"],
  envio: ["recibido", "pago", "preparando", "en_camino", "entregado"],
};

const LABEL: Record<IdPasoSeguimiento, string> = {
  recibido: "Pedido recibido",
  pago: "Pago confirmado",
  preparando: "Preparando",
  en_camino: "En camino",
  entregado: "Entregado",
  retirado: "Retirado",
};

const DESDE_CONFIRMADO: readonly OrderEstado[] = ["confirmado", "preparacion", "en_camino", "entregado"];
const DESDE_PREPARACION: readonly OrderEstado[] = ["preparacion", "en_camino", "entregado"];
const DESDE_EN_CAMINO: readonly OrderEstado[] = ["en_camino", "entregado"];

function hecho(paso: IdPasoSeguimiento, o: Pedido): boolean {
  switch (paso) {
    case "recibido":
      return true;
    case "pago":
      return o.pagoEstado === "pagado" || DESDE_CONFIRMADO.includes(o.estado);
    case "preparando":
      return DESDE_PREPARACION.includes(o.estado);
    case "en_camino":
      return DESDE_EN_CAMINO.includes(o.estado);
    case "entregado":
    case "retirado":
      return o.estado === "entregado";
  }
}

export function seguimientoPedido(o: Pedido): PasoSeguimiento[] | null {
  if (o.estado === "cancelado") return null;

  let actualAsignado = false;
  return PASOS[o.entregaTipo].map((id) => {
    let state: StepState;
    if (hecho(id, o)) state = "done";
    else if (!actualAsignado) {
      state = "current";
      actualAsignado = true;
    } else state = "pending";
    return { id, label: LABEL[id], state };
  });
}
