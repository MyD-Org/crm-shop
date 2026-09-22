"use client";

import { useState } from "react";
import { Badge, Button, Dialog } from "@myd-org/ui";
import type { Facetas } from "@/lib/catalog";
import { cambiarBorrador, hrefAlAplicar, limpiarBorrador } from "@/lib/catalogo-borrador";
import type { EstadoCatalogo } from "@/lib/catalogo-url";
import { contarFiltrosActivos, etiquetaBotonFiltros } from "@/lib/catalogo-vista";
import { CatalogoFiltros } from "./CatalogoFiltros";

/**
 * Filtros en mobile (debajo de `lg`): botón "Filtros (n)" que abre una hoja
 * (`Dialog placement="sheet"` del DS) con el MISMO panel que el aside.
 *
 * Adentro de la hoja los toques no navegan: van a un borrador local,
 * sembrado desde la URL cada vez que se abre, y "Aplicar" hace una sola
 * navegación (ver src/lib/catalogo-borrador.ts). Cerrar con la X, `Escape`
 * o el fondo descarta el borrador. Los conteos y el rango son los de la URL
 * vigente.
 *
 * El foco queda atrapado en la hoja y vuelve a este botón al cerrar (lo
 * resuelve el `Dialog` del DS).
 */
export function CatalogoFiltrosSheet({
  facetas,
  estado,
  navegar,
}: {
  facetas: Facetas;
  /** Estado vigente (la URL). */
  estado: EstadoCatalogo;
  /** Navega a una URL del catálogo (el padre la envuelve en una transición). */
  navegar: (href: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState(estado);
  const activos = contarFiltrosActivos(estado);

  const abrir = () => {
    setBorrador(estado);
    setAbierto(true);
  };

  const aplicar = () => {
    setAbierto(false);
    const href = hrefAlAplicar(estado, borrador);
    if (href) navegar(href);
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={abrir}
        aria-label={etiquetaBotonFiltros(activos)}
        aria-haspopup="dialog"
      >
        Filtros
        {activos > 0 && <Badge tone="info">{activos}</Badge>}
      </Button>

      <Dialog
        open={abierto}
        onOpenChange={setAbierto}
        placement="sheet"
        title="Filtros"
        description="Los cambios se aplican al pulsar «Aplicar»."
        footer={
          <>
            <Button variant="ghost" onClick={() => setBorrador(limpiarBorrador(borrador))}>
              Limpiar filtros
            </Button>
            <Button variant="primary" onClick={aplicar}>
              Aplicar
            </Button>
          </>
        }
      >
        <CatalogoFiltros
          dentroDeSheet
          facetas={facetas}
          estado={borrador}
          ir={(cambios) => setBorrador((b) => cambiarBorrador(b, cambios))}
        />
      </Dialog>
    </>
  );
}
