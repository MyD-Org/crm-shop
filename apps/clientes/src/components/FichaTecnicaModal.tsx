"use client";

import { useRef, useState } from "react";
import { Dialog } from "@myd-org/ui";

/**
 * Botón "Ver ficha técnica" + modal con el PDF embebido. Mismo patrón que
 * MediosDePagoModal (Dialog controlado, foco devuelto al botón al cerrar).
 *
 * El iframe se monta recién al abrir: la ficha no baja el PDF si nadie lo mira.
 * En pantallas chicas el PDF embebido se ve mal (Chrome de Android ni lo dibuja):
 * ahí el enlace se sigue normal y el PDF se abre/descarga con el visor del celular.
 */
const MEDIA_MODAL = "(min-width: 768px)";

export function FichaTecnicaModal({ url, nombreProducto }: { url: string; nombreProducto: string }) {
  const [abierto, setAbierto] = useState(false);
  const botonRef = useRef<HTMLAnchorElement>(null);
  const cambiarAbierto = (abrir: boolean) => {
    setAbierto(abrir);
    if (!abrir) requestAnimationFrame(() => botonRef.current?.focus());
  };

  return (
    <>
      <a
        ref={botonRef}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        download
        onClick={(e) => {
          if (!window.matchMedia(MEDIA_MODAL).matches) return;
          e.preventDefault();
          setAbierto(true);
        }}
        className="inline-flex items-center gap-2 rounded-sm text-sm font-semibold text-accent underline decoration-accent/35 underline-offset-4 transition-colors hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        <FileIcon />
        {/* Mismo corte que MEDIA_MODAL (md = 768px): en el celular el enlace
            baja el PDF, así que dice "Descargar"; desde md abre el modal. */}
        <span className="md:hidden">Descargar ficha técnica</span>
        <span className="hidden md:inline">Ver ficha técnica</span>
      </a>
      <Dialog
        open={abierto}
        onOpenChange={cambiarAbierto}
        title="Ficha técnica"
        description={nombreProducto}
        size="lg"
        footer={
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="text-sm font-semibold underline underline-offset-2 hover:no-underline"
          >
            Descargar PDF
          </a>
        }
      >
        {abierto && (
          <iframe
            src={url}
            title={`Ficha técnica de ${nombreProducto}`}
            className="block h-[70vh] w-full border-0"
          />
        )}
      </Dialog>
    </>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </svg>
  );
}
