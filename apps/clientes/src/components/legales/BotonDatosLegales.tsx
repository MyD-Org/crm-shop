"use client";

import { useState } from "react";
import { Button } from "@myd-org/ui";
import type { DatosLegales } from "@/data/home-defaults";
import { DialogoDatosLegales } from "./DialogoDatosLegales";

/** Botón "Editar datos legales" de las páginas legales. Solo se monta para admins. */
export function BotonDatosLegales({ inicial }: { inicial: DatosLegales }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        Editar datos legales
      </Button>
      <DialogoDatosLegales inicial={inicial} open={abierto} onOpenChange={setAbierto} />
    </>
  );
}
