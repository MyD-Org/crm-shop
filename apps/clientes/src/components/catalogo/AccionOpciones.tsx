"use client";

import { useState, type MouseEvent } from "react";
import { Button } from "@myd-org/ui";
import { CartIcon } from "@/components/catalogo/iconos";
import { PanelOpciones } from "@/components/catalogo/PanelOpciones";
import type { Product } from "@/data/products";

/**
 * El botón «Agregar» de la card de un modelo con opciones (flag `variantes-selector`): se ve igual que
 * el de un producto suelto, pero en vez de sumar al carrito abre el panel donde se elige la opción.
 * `alAbrir` deja a la card cortar la navegación cuando está envuelta en un `<Link>`.
 */
export function BotonAgregarOpciones({ onClick }: { onClick: (e: MouseEvent) => void }) {
  return (
    <Button variant="soft" className="w-full" aria-haspopup="dialog" onClick={onClick}>
      <CartIcon />
      Agregar
    </Button>
  );
}

/** Botón + panel para las cards del listado, cuyo slot de acción ya está fuera del enlace de la card. */
export function AccionOpciones({ producto, titulo }: { producto: Pick<Product, "id" | "images">; titulo: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <BotonAgregarOpciones onClick={() => setAbierto(true)} />
      <PanelOpciones producto={producto} titulo={titulo} abierto={abierto} onAbiertoChange={setAbierto} />
    </>
  );
}
