"use client";

import { Button, cn, useToast } from "@myd-org/ui";
import { compartirEnlace } from "@/lib/compartir";

function IconoCompartir() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" />
    </svg>
  );
}

/**
 * Compartir un producto: hoja nativa en el celular, copiar el enlace en escritorio.
 *
 * - Ficha: sin `href`, el enlace es la dirección de la página tal cual (sin
 *   parámetros propios); la vista previa sale de la metadata de `producto/[id]`.
 * - Card del catálogo: `href` es la ruta de la ficha (`/producto/<id>`) y se
 *   arma absoluta con el origen del sitio. El botón va en el `cornerAction` de
 *   la card, fuera del enlace estirado: no navega.
 */
export function BotonCompartir({
  titulo,
  href,
  className,
}: {
  titulo: string;
  href?: string;
  className?: string;
}) {
  const { toast } = useToast();

  async function compartir() {
    const url = href ? new URL(href, window.location.origin).href : window.location.href;
    const resultado = await compartirEnlace({ url, titulo });
    if (resultado === "copiado") {
      toast({
        title: "Enlace copiado",
        description: "Ya puede pegarlo donde quiera compartirlo.",
        tone: "success",
      });
    } else if (resultado === "error") {
      toast({
        title: "No se pudo copiar el enlace",
        description: href
          ? "Abra el producto y copie la dirección desde la barra del navegador."
          : "Copie la dirección desde la barra del navegador.",
        tone: "danger",
      });
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      shape="round"
      className={cn(className)}
      aria-label="Compartir producto"
      onClick={() => void compartir()}
    >
      <IconoCompartir />
    </Button>
  );
}
