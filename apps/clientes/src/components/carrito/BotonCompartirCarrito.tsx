"use client";

import { useSyncExternalStore } from "react";
import { Button, DropdownMenu, useToast } from "@myd-org/ui";
import type { LineaCarrito } from "@/lib/carrito-cliente";
import { hrefCompartido, hrefWhatsApp, mensajeCompartido } from "@/lib/carrito-compartido";

function IconoCompartir() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" />
    </svg>
  );
}

function IconoWhatsApp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21l1.65-4.8A8.5 8.5 0 1 1 7.8 19.4L3 21z" />
      <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2L9 9.5z" />
    </svg>
  );
}

function IconoEnlace() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
}

function IconoMas() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

const sinSuscripcion = () => () => {};

/**
 * Compartir el carrito con un menú propio: WhatsApp (el canal de casi todos),
 * copiar el enlace y, sólo donde existe `navigator.share`, "Más opciones" para
 * abrir la hoja del sistema a pedido. No se abre la hoja nativa de entrada: en
 * escritorio ofrece AirDrop, Notas o Recordatorios y no WhatsApp.
 *
 * El enlace lleva sólo `id:qty` (ver src/lib/carrito-compartido.ts): quien lo
 * abre ve los precios de SU lista y decide si lo carga.
 */
export function BotonCompartirCarrito({ items }: { items: readonly LineaCarrito[] }) {
  const { toast } = useToast();
  // false en el servidor: el ítem aparece recién en el navegador que la tenga.
  const conHojaNativa = useSyncExternalStore(
    sinSuscripcion,
    () => typeof navigator.share === "function",
    () => false,
  );

  const urlCompartida = () => `${window.location.origin}${hrefCompartido(items)}`;

  function porWhatsApp() {
    window.open(hrefWhatsApp(urlCompartida()), "_blank", "noopener,noreferrer");
  }

  async function copiar() {
    const url = urlCompartida();
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Enlace copiado",
        description: "Ya puede pegarlo donde quiera compartir su carrito.",
        tone: "success",
      });
    } catch {
      toast({ title: "No se pudo copiar el enlace", description: url, tone: "danger" });
    }
  }

  async function masOpciones() {
    const url = urlCompartida();
    try {
      await navigator.share({ text: mensajeCompartido(url), url });
    } catch {
      // Cerrar la hoja sin elegir nada no es un error: no se avisa nada.
    }
  }

  return (
    <DropdownMenu
      align="end"
      className="min-w-[13rem]"
      items={[
        { label: "WhatsApp", icon: <IconoWhatsApp />, onSelect: porWhatsApp },
        { label: "Copiar enlace", icon: <IconoEnlace />, onSelect: () => void copiar() },
        ...(conHojaNativa
          ? [
              { type: "separator" as const },
              { label: "Más opciones", icon: <IconoMas />, onSelect: () => void masOpciones() },
            ]
          : []),
      ]}
    >
      <Button type="button" variant="outline" size="sm">
        <IconoCompartir />
        Compartir carrito
      </Button>
    </DropdownMenu>
  );
}
