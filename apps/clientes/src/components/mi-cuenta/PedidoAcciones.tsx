"use client";

import { useRouter } from "next/navigation";
import { Button, useToast } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { useCart } from "@/context/CartContext";
import type { OrderItem } from "@/data/orders";
import { hrefPedido } from "@/lib/mi-cuenta-nav";
import { IconoDescarga, IconoFlecha, IconoRefresh } from "./iconos";

/**
 * Acciones de un pedido: ver el detalle, volver a comprar (suma las mismas
 * cantidades al carrito; el precio y el stock se confirman ahí) y, cuando el
 * pedido tenga factura vinculada, descargarla. Hoy `facturaId` nunca viene
 * (follow-up `pedidos-factura-vinculada`), así que ese botón no se ve.
 */
export function PedidoAcciones({
  pedidoId,
  items,
  facturaId,
  mostrarDetalle = true,
}: {
  pedidoId: string;
  items: OrderItem[];
  facturaId?: string;
  mostrarDetalle?: boolean;
}) {
  const { addItem } = useCart();
  const { toast } = useToast();
  const router = useRouter();

  function volverAComprar() {
    for (const item of items) {
      addItem({ id: item.id, name: item.nombreVisible, brand: item.brand, price: item.price }, item.qty);
    }
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
      <Button variant="outline" onClick={volverAComprar}>
        <IconoRefresh /> Volver a comprar
      </Button>
      {facturaId && (
        <Button variant="outline" href={`/api/mi-cuenta/facturas/${facturaId}/pdf`}>
          <IconoDescarga /> Descargar factura
        </Button>
      )}
    </div>
  );
}
