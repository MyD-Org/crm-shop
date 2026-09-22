"use client";

import { useState, type ReactNode } from "react";
import { Button, cn } from "@myd-org/ui";
import type { SeccionHome } from "@/data/home-defaults";
import { useModoEdicion } from "./ModoEdicion";
import { DialogoSeccion } from "./DialogoSeccion";

/**
 * Envuelve una sección de `HomeClient.tsx` con el botón "Editar sección"
 * (rebanada B1 de home-editable). Con `puedeEditar === false` no agrega
 * ningún markup: costo cero para un visitante sin sesión de admin.
 */
export function SeccionEditable({
  seccion,
  inicial,
  puedeEditar,
  className,
  children,
}: {
  seccion: SeccionHome;
  inicial: unknown;
  puedeEditar: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { activo } = useModoEdicion();
  const [open, setOpen] = useState(false);

  if (!puedeEditar) return <>{children}</>;

  return (
    <div data-editor="" className={cn("relative", className)}>
      {children}
      {activo ? (
        <Button
          size="sm"
          variant="secondary"
          className="absolute right-2 top-2 z-10"
          aria-label="Editar sección"
          onClick={() => setOpen(true)}
        >
          Editar sección
        </Button>
      ) : null}
      <DialogoSeccion seccion={seccion} inicial={inicial} open={open} onOpenChange={setOpen} />
    </div>
  );
}
