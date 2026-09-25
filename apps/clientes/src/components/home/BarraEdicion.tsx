"use client";

import { useState } from "react";
import { Button, Switch } from "@myd-org/ui";
import { visibilidadDe, type DatosLegales, type MapaVisibilidad, type Visibilidad } from "@/data/home-defaults";
import type { DatosFooter } from "@/data/footer";
import { DialogoDatosLegales } from "@/components/legales/DialogoDatosLegales";
import { DialogoFooter } from "@/components/footer/DialogoFooter";
import { useModoEdicion } from "./ModoEdicion";
import { DialogoSeccion } from "./DialogoSeccion";
import { useAlOcultar } from "@/lib/use-al-ocultar";

/**
 * Barra fija de modo edición, solo se monta para admins (hueco
 * `EdicionSiAdmin`, ver `src/app/page.tsx`). "Anuncio" y "Badge del menú"
 * abren el Dialog de esas dos secciones (que carga sus datos al abrirse) (no viven en `HomeClient.tsx`, así que no pasan por
 * `SeccionEditable`). Si están restringidas, el botón lo avisa: no hay otro
 * lugar donde se vea. "Datos legales" abre el editor de la fila `legal`
 * (footer y páginas legales). "Footer" abre el editor de la fila `footer`
 * (descripción, Contacto y barra inferior).
 */
const SUFIJO: Record<Visibilidad, string> = {
  siempre: "",
  desktop: " (solo desktop)",
  mobile: " (solo mobile)",
  nunca: " (oculto)",
};
export function BarraEdicion({
  visibilidad,
  legal,
  footer,
}: {
  visibilidad: MapaVisibilidad;
  legal: DatosLegales;
  footer: DatosFooter;
}) {
  const { activo, setActivo } = useModoEdicion();
  const [abrirAnuncio, setAbrirAnuncio] = useState(false);
  const [abrirNavBadge, setAbrirNavBadge] = useState(false);
  const [abrirLegal, setAbrirLegal] = useState(false);
  const [abrirFooter, setAbrirFooter] = useState(false);
  // Al salir de la home los editores se cierran: al volver no reaparecen abiertos.
  useAlOcultar(() => {
    setAbrirAnuncio(false);
    setAbrirNavBadge(false);
    setAbrirLegal(false);
    setAbrirFooter(false);
  });
  const vAnuncio = visibilidadDe(visibilidad, "anuncio");
  const vNavBadge = visibilidadDe(visibilidad, "navBadge");

  return (
    <div
      data-editor=""
      className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-border bg-surface px-4 py-2 shadow-lg"
    >
      <Switch label="Modo edición" checked={activo} onCheckedChange={setActivo} />
      <Button variant="outline" size="sm" onClick={() => setAbrirAnuncio(true)}>
        {`Anuncio${SUFIJO[vAnuncio]}`}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setAbrirNavBadge(true)}>
        {`Badge del menú${SUFIJO[vNavBadge]}`}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setAbrirLegal(true)}>
        Datos legales
      </Button>
      <Button variant="outline" size="sm" onClick={() => setAbrirFooter(true)}>
        Footer
      </Button>
      <DialogoSeccion seccion="anuncio" visibilidad={vAnuncio} open={abrirAnuncio} onOpenChange={setAbrirAnuncio} />
      <DialogoSeccion seccion="navBadge" visibilidad={vNavBadge} open={abrirNavBadge} onOpenChange={setAbrirNavBadge} />
      <DialogoDatosLegales inicial={legal} open={abrirLegal} onOpenChange={setAbrirLegal} />
      <DialogoFooter inicial={footer} open={abrirFooter} onOpenChange={setAbrirFooter} />
    </div>
  );
}
