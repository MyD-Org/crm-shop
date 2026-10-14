"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        Editar footer
      </Button>
      <Button variant="outline" size="sm" onClick={() => router.push("/editar-paginas")}>
        Editar páginas
      </Button>
      <DialogoFooter inicial={inicial} open={abierto} onOpenChange={setAbierto} />
    </>
  );
}
