"use client";

import { useState, type MouseEvent } from "react";
import { Button } from "@myd-org/ui";
import { CartIcon, PlusIcon } from "@/components/catalogo/iconos";
import { PanelOpciones } from "@/components/catalogo/PanelOpciones";
import type { Product } from "@/data/products";

/**
 * El botón «Agregar» de la card de un modelo con opciones (flag `variantes-selector`): se ve igual que
 * el de un producto suelto, pero en vez de sumar al carrito abre el panel donde se elige la opción.
 * `alAbrir` deja a la card cortar la navegación cuando está envuelta en un `<Link>`.
 */
export function BotonAgregarOpciones({ onClick, compacto = false }: { onClick: (e: MouseEvent) => void; compacto?: boolean }) {
  // Compacto: el "+" redondo que va sobre la foto en la card `market`.
  if (compacto)
    return (
      <Button size="icon-lg" shape="round" aria-label="Agregar" aria-haspopup="dialog" onClick={onClick} className="shadow-1">
        <PlusIcon />
      </Button>
    );
  return (
    <Button variant="soft" className="w-full" aria-haspopup="dialog" onClick={onClick}>
      <CartIcon />
      Agregar
    </Button>
  );
}

/** Botón + panel para las cards del listado, cuyo slot de acción ya está fuera del enlace de la card. */
export function AccionOpciones({
  producto,
  titulo,
  compacto = false,
}: {
  producto: Pick<Product, "id" | "images">;
  titulo: string;
  compacto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <BotonAgregarOpciones compacto={compacto} onClick={() => setAbierto(true)} />
      <PanelOpciones producto={producto} titulo={titulo} abierto={abierto} onAbiertoChange={setAbierto} />
    </>
  );
}
