"use client";

import { useState, type ReactNode } from "react";
import { Badge, Button, cn } from "@myd-org/ui";
import { clasesVisibilidad, type SeccionHome, type Visibilidad } from "@/data/home-defaults";
import { useModoEdicion } from "./ModoEdicion";
import { DialogoSeccion } from "./DialogoSeccion";

/**
 * Envuelve una sección de `HomeClient.tsx` con el botón "Editar sección"
 * (rebanada B1 de home-editable). Con `puedeEditar === false` no agrega
 * ningún markup: costo cero para un visitante sin sesión de admin.
 *
 * `visibilidad`: dónde la ve el visitante. "nunca" no se pinta; "desktop" y
 * "mobile" se ocultan por CSS en el otro tamaño. El admin fuera del modo
 * edición la ve igual que un cliente; en modo edición se ve siempre, atenuada
 * y marcada donde el visitante no la ve, para poder cambiarlo desde el Dialog.
 */
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
  nunca: "Oculta en la tienda",
};

function ComoVisitante({ visibilidad, children }: { visibilidad: Visibilidad; children: ReactNode }) {
  if (visibilidad === "nunca") return null;
  if (visibilidad === "siempre") return <>{children}</>;
  // `contents`: el envoltorio no altera el layout de la sección.
  return <div className={cn("contents", clasesVisibilidad(visibilidad))}>{children}</div>;
}
export function SeccionEditable({
  seccion,
  inicial,
  puedeEditar,
  visibilidad = "siempre",
  className,
  children,
}: {
  seccion: SeccionHome;
  inicial: unknown;
  puedeEditar: boolean;
  visibilidad?: Visibilidad;
  className?: string;
  children: ReactNode;
}) {
  const { activo } = useModoEdicion();
  const [open, setOpen] = useState(false);

  if (!puedeEditar || !activo) return <ComoVisitante visibilidad={visibilidad}>{children}</ComoVisitante>;
  const marca = MARCA[visibilidad];

  return (
    <div data-editor="" className={cn("relative", className)}>
      {marca ? <div className={ATENUADA[visibilidad]}>{children}</div> : children}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
        {marca ? <Badge tone="warning">{marca}</Badge> : null}
        <Button size="sm" variant="secondary" aria-label="Editar sección" onClick={() => setOpen(true)}>
          Editar sección
        </Button>
      </div>
      <DialogoSeccion seccion={seccion} inicial={inicial} visibilidad={visibilidad} open={open} onOpenChange={setOpen} />
    </div>
  );
}
