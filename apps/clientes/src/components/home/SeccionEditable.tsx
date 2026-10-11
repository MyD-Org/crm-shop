"use client";

import { useState, type ReactNode } from "react";
import { Badge, Button, cn } from "@myd-org/ui";
import { clasesVisibilidad, type SeccionHome, type Visibilidad } from "@/data/home-defaults";
import { useModoEdicion } from "./ModoEdicion";
import { DialogoSeccion } from "./DialogoSeccion";
import { useAlOcultar } from "@/lib/use-al-ocultar";
import { aMascara, TITULOS_SECCION } from "@/lib/home-editor";

/**
 * Envuelve una sección de `HomeClient.tsx` con el botón "Editar sección"
 * (rebanada B1 de home-editable). `puedeEditar` sale del contexto
 * (`ModoEdicion`), que solo prende el hueco `EdicionSiAdmin`: para un
 * visitante no agrega ningún markup ni datos del editor (el Dialog los pide
 * al abrirse).
 *
 * `visibilidad`: dónde la ve el visitante. "nunca" no se pinta; "desktop" y
 * "mobile" se ocultan por CSS en el otro tamaño. El admin fuera del modo
 * edición la ve igual que un cliente; en modo edición se ve siempre, atenuada
 * y marcada donde el visitante no la ve, para poder cambiarlo desde el Dialog.
 *
 * `apagada`: la sección no se pinta para el visitante por algo ajeno al
 * editor (un flag). En modo edición se ve igual, atenuada y marcada, para
 * poder editarla y elegir dónde se muestra antes de prenderla.
 *
 * `botonTop`: clase `top-*` del botón. Las secciones que arrancan con aire
 * (padding o margen de separación) lo bajan hasta su título o su contenido:
 * arriba de todo quedaba pegado a la sección anterior y parecía de ella.
 *
 * `titulo`: el título que la sección muestra en la tienda (con sus marcas de
 * acento). El botón y el Dialog la nombran así; sin él, por su nombre interno.
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
  visibilidad = "siempre",
  apagada = false,
  botonTop = "top-2",
  titulo,
  className,
  children,
}: {
  seccion: SeccionHome;
  visibilidad?: Visibilidad;
  apagada?: boolean;
  botonTop?: string;
  titulo?: string;
  className?: string;
  children: ReactNode;
}) {
  const { puedeEditar, activo } = useModoEdicion();
  const [open, setOpen] = useState(false);
  // Al salir de la home el editor se cierra: al volver no reaparece abierto.
  useAlOcultar(() => setOpen(false));

  if (!puedeEditar || !activo) {
    return apagada ? null : <ComoVisitante visibilidad={visibilidad}>{children}</ComoVisitante>;
  }
  const nombre = (titulo ? aMascara(titulo).texto.trim() : "") || TITULOS_SECCION[seccion];
  const marca = apagada ? "Desactivada en la tienda" : MARCA[visibilidad];
  const atenuada = apagada ? ATENUADA.nunca : ATENUADA[visibilidad];

  return (
    <div data-editor="" className={cn("relative", className)}>
      {marca ? <div className={atenuada}>{children}</div> : children}
      <div className={cn("absolute right-2 z-10 flex items-center gap-2", botonTop)}>
        {marca ? <Badge tone="warning">{marca}</Badge> : null}
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Editar: {nombre}
        </Button>
      </div>
      <DialogoSeccion seccion={seccion} titulo={nombre} visibilidad={visibilidad} open={open} onOpenChange={setOpen} />
    </div>
  );
}
