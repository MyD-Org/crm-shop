import Image from "next/image";
import Link from "next/link";
import type { OrderItem } from "@/data/orders";
import { fmtPrecio } from "@/lib/format";
import { subtituloLinea } from "@/lib/pedido-vista";
import { IconoLampara } from "./iconos";

/**
 * Una línea de pedido: miniatura (o placeholder), nombre real con enlace a la
 * ficha, "Cód. X · N u." y el total de la línea. Se compone acá con la escala
 * estándar y roles del DS (DSM-7: sin componente propio en el DS).
 */
export function PedidoLinea({ item, detalle = false }: { item: OrderItem; detalle?: boolean }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-elevated text-muted">
        {item.imagen ? (
          <Image
            src={item.imagen.url}
            alt={item.imagen.alt ?? item.nombreVisible}
            width={48}
            height={48}
            sizes="48px"
            className="h-full w-full object-contain"
          />
        ) : (
          <IconoLampara />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <Link
          href={`/producto/${item.id}`}
          className="truncate text-sm font-medium text-text hover:text-primary"
        >
          {item.nombreVisible}
        </Link>
        <span className="text-xs text-muted">{subtituloLinea(item, { detalle })}</span>
      </span>
      <span className="shrink-0 text-sm font-semibold text-text">{fmtPrecio(item.total)}</span>
    </li>
  );
}
