"use client";

import { useState } from "react";
import { Button } from "@myd-org/ui";
import type { DatosFooter } from "@/data/footer";
import { DialogoFooter } from "./DialogoFooter";

/**
 * Botón "Editar footer" que se pinta arriba del footer, en todas las páginas.
 * Solo se monta para admins (`SiteFooter.tsx`): el visitante no recibe ni el
 * botón ni el editor.
 */
export function BotonEditarFooter({ inicial }: { inicial: DatosFooter }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        Editar footer
      </Button>
      <DialogoFooter inicial={inicial} open={abierto} onOpenChange={setAbierto} />
    </>
  );
}
