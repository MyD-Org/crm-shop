import { Button } from "@myd-org/ui";
import type { ContactoPedidoVista } from "@/lib/contacto-pedido";

/**
 * Plazo de contacto y WhatsApp de la sucursal de un pedido "a confirmar". Sirve tanto en la pantalla de confirmación del checkout como en el detalle
 * del pedido en Mi cuenta. Sin número de WhatsApp (pedido sin sucursal, o sucursal sin número) se
 * muestra sólo el texto.
 *
 * `mostrarPlazo = false` (pedido ya confirmado o en camino) omite el compromiso de contacto y deja
 * sólo el enlace.
 */
export function PedidoContacto({
  contacto,
  mostrarPlazo = true,
  centrado = false,
  className = "",
}: {
  contacto: ContactoPedidoVista;
  mostrarPlazo?: boolean;
  /** Texto y botón centrados (pantalla de confirmación). */
  centrado?: boolean;
  className?: string;
}) {
  const { whatsapp } = contacto;
  if (!mostrarPlazo && !whatsapp) return null;
  return (
    <div
      className={`flex flex-col gap-3 ${centrado ? "items-center text-center" : ""} ${className}`}
    >
      {mostrarPlazo && <p className="whitespace-pre-line text-sm text-text">{contacto.mensaje}</p>}
      {whatsapp && (
        <div className={`flex flex-col gap-2 ${centrado ? "items-center" : ""}`}>
          <p className="text-sm text-muted">
            Si lo prefiere, escríbanos por WhatsApp al {whatsapp.visible}.
          </p>
          <a
            href={whatsapp.url}
            target="_blank"
            rel="noopener noreferrer"
            className={centrado ? "self-center" : "self-start"}
          >
            <Button variant="secondary">Escribir por WhatsApp</Button>
          </a>
        </div>
      )}
    </div>
  );
}
