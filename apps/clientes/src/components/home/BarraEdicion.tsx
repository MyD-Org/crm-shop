"use client";

import { useState } from "react";
import { Button, Switch } from "@myd-org/ui";
import type { HomeContent, NavBadgeContent, SeccionHome } from "@/data/home-defaults";
import { useModoEdicion } from "./ModoEdicion";
import { DialogoSeccion } from "./DialogoSeccion";

/**
 * Barra fija de modo edición, solo se monta si `puedeEditar` (ver
 * `src/app/page.tsx`). "Anuncio" y "Badge del menú" abren el Dialog de esas
 * dos secciones (no viven en `HomeClient.tsx`, así que no pasan por
 * `SeccionEditable`). Si están ocultas, el botón lo avisa: no hay otro
 * lugar donde se vea.
 */
export function BarraEdicion({
  anuncio,
  navBadge,
  ocultas,
}: {
  anuncio: HomeContent["anuncio"];
  navBadge: NavBadgeContent | null;
  ocultas: readonly SeccionHome[];
}) {
  const { activo, setActivo } = useModoEdicion();
  const [abrirAnuncio, setAbrirAnuncio] = useState(false);
  const [abrirNavBadge, setAbrirNavBadge] = useState(false);

  return (
    <div
      data-editor=""
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-4 border-t border-border bg-surface px-4 py-2 shadow-lg"
    >
      <Switch label="Modo edición" checked={activo} onCheckedChange={setActivo} />
      <Button variant="outline" size="sm" onClick={() => setAbrirAnuncio(true)}>
        {ocultas.includes("anuncio") ? "Anuncio (oculto)" : "Anuncio"}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setAbrirNavBadge(true)}>
        {ocultas.includes("navBadge") ? "Badge del menú (oculto)" : "Badge del menú"}
      </Button>
      <DialogoSeccion seccion="anuncio" inicial={anuncio} oculta={ocultas.includes("anuncio")} open={abrirAnuncio} onOpenChange={setAbrirAnuncio} />
      <DialogoSeccion seccion="navBadge" inicial={navBadge} oculta={ocultas.includes("navBadge")} open={abrirNavBadge} onOpenChange={setAbrirNavBadge} />
    </div>
  );
}
