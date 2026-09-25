"use client";

import { useState } from "react";
import { Button } from "@myd-org/ui";
import type { DatosLegales } from "@/data/home-defaults";
import { DialogoDatosLegales } from "./DialogoDatosLegales";
import { useAlOcultar } from "@/lib/use-al-ocultar";

/** Botón "Editar datos legales" de las páginas legales. Solo se monta para admins. */
export function BotonDatosLegales({ inicial }: { inicial: DatosLegales }) {
  const [abierto, setAbierto] = useState(false);
  // Al salir de la página el editor se cierra: al volver no reaparece abierto.
  useAlOcultar(() => setAbierto(false));
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        Editar datos legales
      </Button>
      <DialogoDatosLegales inicial={inicial} open={abierto} onOpenChange={setAbierto} />
    </>
  );
}
