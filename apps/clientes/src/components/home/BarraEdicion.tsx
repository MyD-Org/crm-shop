"use client";

import { useState } from "react";
import { Button, Switch } from "@myd-org/ui";
import { visibilidadDe, type HomeContent, type MapaVisibilidad, type NavBadgeContent, type Visibilidad } from "@/data/home-defaults";
import { useModoEdicion } from "./ModoEdicion";
import { DialogoSeccion } from "./DialogoSeccion";

/**
 * Barra fija de modo edición, solo se monta si `puedeEditar` (ver
 * `src/app/page.tsx`). "Anuncio" y "Badge del menú" abren el Dialog de esas
 * dos secciones (no viven en `HomeClient.tsx`, así que no pasan por
 * `SeccionEditable`). Si están restringidas, el botón lo avisa: no hay otro
 * lugar donde se vea.
 */
const SUFIJO: Record<Visibilidad, string> = {
  siempre: "",
  desktop: " (solo desktop)",
  mobile: " (solo mobile)",
  nunca: " (oculto)",
};
export function BarraEdicion({
  anuncio,
  navBadge,
  visibilidad,
}: {
  anuncio: HomeContent["anuncio"];
  navBadge: NavBadgeContent | null;
  visibilidad: MapaVisibilidad;
}) {
  const { activo, setActivo } = useModoEdicion();
  const [abrirAnuncio, setAbrirAnuncio] = useState(false);
  const [abrirNavBadge, setAbrirNavBadge] = useState(false);
  const vAnuncio = visibilidadDe(visibilidad, "anuncio");
  const vNavBadge = visibilidadDe(visibilidad, "navBadge");

  return (
    <div
      data-editor=""
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-4 border-t border-border bg-surface px-4 py-2 shadow-lg"
    >
      <Switch label="Modo edición" checked={activo} onCheckedChange={setActivo} />
      <Button variant="outline" size="sm" onClick={() => setAbrirAnuncio(true)}>
        {`Anuncio${SUFIJO[vAnuncio]}`}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setAbrirNavBadge(true)}>
        {`Badge del menú${SUFIJO[vNavBadge]}`}
      </Button>
      <DialogoSeccion seccion="anuncio" inicial={anuncio} visibilidad={vAnuncio} open={abrirAnuncio} onOpenChange={setAbrirAnuncio} />
      <DialogoSeccion seccion="navBadge" inicial={navBadge} visibilidad={vNavBadge} open={abrirNavBadge} onOpenChange={setAbrirNavBadge} />
    </div>
  );
}
