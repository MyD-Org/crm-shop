"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, DocumentViewer, useToast } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { useCart } from "@/context/CartContext";
import type { OrderItem } from "@/data/orders";
import { hrefPedido } from "@/lib/mi-cuenta-nav";
import { useAlOcultar } from "@/lib/use-al-ocultar";
import { BotonCompartirLista } from "@/components/BotonCompartirLista";
import { MENSAJE_PEDIDO } from "@/lib/carrito-compartido";
import { AVISO_PEDIDO_RECORTADO, pedidoCompartible } from "@/lib/pedido-compartir";
import { IconoDescarga, IconoFlecha, IconoRefresh } from "./iconos";

/**
 * Acciones de un pedido: ver el detalle, volver a comprar (suma las mismas
 * cantidades al carrito; el precio y el stock se confirman ahí) y, cuando un
 * operador del CRM vinculó una factura de Alegra al pedido (`facturaId`),
 * verla en el visor del DS (el mismo de Facturación), que ofrece descargarla.
 * El PDF es por pedido (`/api/mi-cuenta/pedidos/[id]/factura/pdf`): sirve para
 * cualquier dueño del pedido, tenga o no cuenta corriente.
 */
export function PedidoAcciones({
  pedidoId,
  items,
  facturaId,
  facturaNumero,
  reintentarPago = false,
  mostrarDetalle = true,
  alPie = false,
  compartir = false,
  extra,
}: {
  pedidoId: string;
  items: OrderItem[];
  facturaId?: string;
  facturaNumero?: string;
  /** Pago en línea rechazado y pedido cobrable: "Reintentar el pago" pasa a ser la acción principal. */
  reintentarPago?: boolean;
  mostrarDetalle?: boolean;
  /** Al pie de una card (con separador): una fila en escritorio, apiladas a lo ancho en mobile. */
  alPie?: boolean;
  /** Ofrece "Compartir pedido" (link al carrito compartido con las mismas líneas). */
  compartir?: boolean;
  /** Acción a la derecha de la fila (p. ej. cancelar el pedido); sólo con `alPie`. */
  extra?: ReactNode;
}) {
  const { addItems } = useCart();
  const { toast } = useToast();
  const router = useRouter();
  // Evita duplicar los ítems si se toca dos veces antes de llegar al carrito.
  // Con Cache Components la página no se desmonta al navegar (queda oculta),
  // así que hay que resetear al ocultarse o el botón queda deshabilitado para
  // siempre si vuelve a este pedido (ver `useAlOcultar`).
  const [agregando, setAgregando] = useState(false);
  useAlOcultar(() => setAgregando(false));
  const [verFactura, setVerFactura] = useState(false);
  const urlFactura = `/api/mi-cuenta/pedidos/${pedidoId}/factura/pdf`;
  const paraCompartir = compartir ? pedidoCompartible(items) : null;
  const tituloFactura = facturaNumero ? `Factura ${facturaNumero}` : "Factura";

  function volverAComprar() {
    if (agregando) return;
    setAgregando(true);
    // Una sola actualización del carrito: con sesión, un solo guardado.
    addItems(
      items.map((item) => ({
        item: {
          id: item.id,
          name: item.nombreVisible,
          brand: item.brand,
          price: item.price,
          image: item.imagen?.url,
        },
        qty: item.qty,
      })),
    );
    toast({
      title: "Productos agregados al carrito",
      description: "Confirmamos precio y stock actuales en el carrito.",
      tone: "success",
      action: { label: "Ver carrito", href: "/carrito" },
    });
    router.push("/carrito");
  }

  const contenedor = alPie
    ? "mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-center"
    : "flex flex-wrap items-center gap-2";

  return (
    <div className={contenedor}>
      {reintentarPago && (
        <Button href={`/checkout?pedido=${pedidoId}`} renderLink={linkNext}>
          Reintentar el pago
        </Button>
      )}
      {mostrarDetalle && (
        <Button variant={reintentarPago ? "outline" : "primary"} href={hrefPedido(pedidoId)} renderLink={linkNext}>
          Ver detalle <IconoFlecha />
        </Button>
      )}
      <Button variant="outline" loading={agregando} onClick={volverAComprar}>
        <IconoRefresh /> Volver a comprar
      </Button>
      {paraCompartir && paraCompartir.lineas > 0 && (
        <BotonCompartirLista
          href={paraCompartir.href}
          label="Compartir pedido"
          mensaje={MENSAJE_PEDIDO}
          toast={{
            title: "Enlace copiado",
            description: "Ya puede pegarlo donde quiera compartir su pedido.",
          }}
          aviso={paraCompartir.recortado ? AVISO_PEDIDO_RECORTADO : undefined}
        />
      )}
      {facturaId && (
        <>
          <Button variant="outline" onClick={() => setVerFactura(true)}>
            <IconoDescarga /> Factura
          </Button>
          <DocumentViewer
            open={verFactura}
            onOpenChange={setVerFactura}
            title={tituloFactura}
            src={verFactura ? urlFactura : ""}
            downloadHref={`${urlFactura}?download=1`}
            hint={null}
          />
        </>
      )}
      {alPie && extra && <div className="flex flex-col sm:ml-auto">{extra}</div>}
    </div>
  );
}
