"use client";

import { Button, useToast } from "@myd-org/ui";
import type { LineaCarrito } from "@/lib/carrito-cliente";
import { hrefCompartido } from "@/lib/carrito-compartido";
import { compartirEnlace } from "@/lib/compartir";

function IconoCompartir() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" />
    </svg>
  );
}

/**
 * Compartir el carrito: hoja nativa en el celular, copiar el enlace en
 * escritorio. El enlace lleva sólo `id:qty` (ver src/lib/carrito-compartido.ts):
 * quien lo abre ve los precios de SU lista y decide si lo carga.
 */
export function BotonCompartirCarrito({ items }: { items: readonly LineaCarrito[] }) {
  const { toast } = useToast();

  async function compartir() {
    const url = `${window.location.origin}${hrefCompartido(items)}`;
    const resultado = await compartirEnlace({ url, titulo: "Le comparto mi carrito" });
    if (resultado === "copiado") {
      toast({
        title: "Enlace copiado",
        description: "Ya puede pegarlo donde quiera compartir su carrito.",
        tone: "success",
      });
    } else if (resultado === "error") {
      toast({
        title: "No se pudo copiar el enlace",
        description: url,
        tone: "danger",
      });
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void compartir()}>
      <IconoCompartir />
      Compartir carrito
    </Button>
  );
}
