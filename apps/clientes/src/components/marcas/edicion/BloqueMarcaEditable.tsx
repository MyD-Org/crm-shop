"use client";

import { useState, type ReactNode } from "react";
import { Badge, Button, cn } from "@myd-org/ui";
import type { Visibilidad } from "@/data/home-defaults";
import { ComoVisitante } from "@/components/home/SeccionEditable";
import { useModoEdicion } from "@/components/home/ModoEdicion";
import { useAlOcultar } from "@/lib/use-al-ocultar";
import type { BloqueMarca } from "@/lib/marcas/pagina-marca";
import { DialogoBloqueMarca } from "./DialogoBloqueMarca";
import { TITULOS_BLOQUE } from "./editores";

const ATENUADA: Record<Visibilidad, string> = {
  siempre: "",
  desktop: "max-md:opacity-40",
  mobile: "md:opacity-40",
  nunca: "opacity-40",
};
const MARCA: Record<Visibilidad, string | null> = {
  siempre: null,
  desktop: "Solo en desktop",
  mobile: "Solo en mobile",
  nunca: "Oculto en la tienda",
};

/**
 * Envuelve un bloque de una página de marca, como `SeccionEditable` en la
 * home. Para un visitante solo aplica la visibilidad. Para un admin en modo
 * edición agrega "Editar: <bloque>" y, si el bloque no se ve o está vacío, lo
 * muestra igual (atenuado y marcado) para poder completarlo.
 */
export function BloqueMarcaEditable({
  slug,
  bloque,
  visibilidad,
  children,
}: {
  slug: string;
  bloque: BloqueMarca;
  visibilidad: Visibilidad;
  children: ReactNode;
}) {
  const { puedeEditar, activo } = useModoEdicion();
  const [open, setOpen] = useState(false);
  useAlOcultar(() => setOpen(false));

  if (!puedeEditar || !activo) return <ComoVisitante visibilidad={visibilidad}>{children}</ComoVisitante>;

  const marca = MARCA[visibilidad];
  return (
    <div data-editor="" className="relative min-h-14">
      {children ? (
        marca ? <div className={ATENUADA[visibilidad]}>{children}</div> : children
      ) : (
        <div className="mx-auto max-w-contenido px-6 py-6 text-sm text-muted">{TITULOS_BLOQUE[bloque]}: sin contenido todavía.</div>
      )}
      <div className={cn("absolute right-2 top-2 z-10 flex items-center gap-2")}>
        {marca ? <Badge tone="warning">{marca}</Badge> : null}
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Editar: {TITULOS_BLOQUE[bloque]}
        </Button>
      </div>
      <DialogoBloqueMarca slug={slug} bloque={bloque} visibilidad={visibilidad} open={open} onOpenChange={setOpen} />
    </div>
  );
}
