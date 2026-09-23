"use client";

import { useState, type ReactNode } from "react";
import { Badge, Button, cn } from "@myd-org/ui";
import type { SeccionHome } from "@/data/home-defaults";
import { useModoEdicion } from "./ModoEdicion";
import { DialogoSeccion } from "./DialogoSeccion";

/**
 * Envuelve una sección de `HomeClient.tsx` con el botón "Editar sección"
 * (rebanada B1 de home-editable). Con `puedeEditar === false` no agrega
 * ningún markup: costo cero para un visitante sin sesión de admin.
 *
 * Sección `oculta`: el visitante no la ve. El admin tampoco fuera del modo
 * edición (ve la home como la ve un cliente); en modo edición aparece
 * atenuada y marcada, para poder volver a mostrarla desde el Dialog.
 */
export function SeccionEditable({
  seccion,
  inicial,
  puedeEditar,
  oculta = false,
  className,
  children,
}: {
  seccion: SeccionHome;
  inicial: unknown;
  puedeEditar: boolean;
  oculta?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { activo } = useModoEdicion();
  const [open, setOpen] = useState(false);

  if (!puedeEditar) return oculta ? null : <>{children}</>;
  if (oculta && !activo) return null;

  return (
    <div data-editor="" className={cn("relative", className)}>
      {oculta ? <div className="opacity-40">{children}</div> : children}
      {activo ? (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
          {oculta ? <Badge tone="warning">Oculta en la tienda</Badge> : null}
          <Button size="sm" variant="secondary" aria-label="Editar sección" onClick={() => setOpen(true)}>
            Editar sección
          </Button>
        </div>
      ) : null}
      <DialogoSeccion seccion={seccion} inicial={inicial} oculta={oculta} open={open} onOpenChange={setOpen} />
    </div>
  );
}
