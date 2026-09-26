"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, DocumentViewer, useToast } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { useCart } from "@/context/CartContext";
import type { OrderItem } from "@/data/orders";
import { hrefPedido } from "@/lib/mi-cuenta-nav";
import { useAlOcultar } from "@/lib/use-al-ocultar";
import { IconoFactura, IconoFlecha, IconoRefresh } from "./iconos";

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
  mostrarDetalle = true,
}: {
  pedidoId: string;
  items: OrderItem[];
  facturaId?: string;
  facturaNumero?: string;
  mostrarDetalle?: boolean;
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

  return (
    <div className="flex flex-wrap gap-3">
      {mostrarDetalle && (
        <Button href={hrefPedido(pedidoId)} renderLink={linkNext}>
          Ver detalle <IconoFlecha />
        </Button>
      )}
      <Button variant="outline" loading={agregando} onClick={volverAComprar}>
        <IconoRefresh /> Volver a comprar
      </Button>
      {facturaId && (
        <>
          <Button variant="outline" onClick={() => setVerFactura(true)}>
            <IconoFactura size={16} /> Ver factura{facturaNumero ? ` ${facturaNumero}` : ""}
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
    </div>
  );
}
