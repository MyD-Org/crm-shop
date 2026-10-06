"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Card, ProductCardSkeleton, cn } from "@myd-org/ui";

/**
 * Cards de un producto cuyo precio de la cuenta todavía no llegó o no existe (listas privadas, change
 * `listas-cuenta-corriente`). La `ProductCard` del DS exige un precio numérico y siempre lo dibuja:
 * para estos dos estados no se usa, así nunca aparece el precio público de otro ni un "$0".
 *
 * - Pendiente: el esqueleto del DS, de la misma silueta que la card (sin parpadeo de precio).
 * - Consulte: card compuesta con la `Card` del DS; sin precio y sin botón de agregar.
 */

type Layout = "grid" | "list";

export function TarjetaPrecioPendiente({ layout = "grid" }: { layout?: Layout }) {
  return <ProductCardSkeleton variant="soft" layout={layout} className="h-full" />;
}

export function TarjetaConsulte({
  href,
  nombre,
  marca,
  imagen,
  layout = "grid",
}: {
  href: string;
  nombre: string;
  marca?: string;
  /** Imagen ya armada (p. ej. `next/image` con `fill`), dentro de un contenedor relativo. */
  imagen: ReactNode;
  layout?: Layout;
}) {
  const lista = layout === "list";
  return (
    <Card className={cn("relative h-full overflow-hidden p-3", lista ? "flex items-center gap-4" : "flex flex-col gap-3")}>
      <div className={cn("relative shrink-0 overflow-hidden rounded-xl bg-elevated", lista ? "h-24 w-24" : "aspect-square w-full")}>
        {imagen}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {marca ? <span className="text-xs text-muted">{marca}</span> : null}
        <Link
          href={href}
          className="line-clamp-2 text-sm font-semibold text-text after:absolute after:inset-0 after:content-['']"
        >
          {nombre}
        </Link>
        <span className="font-display text-lg font-semibold text-text">Consulte</span>
        <span className="text-xs text-muted">Este producto no tiene precio para su cuenta.</span>
      </div>
    </Card>
  );
}
