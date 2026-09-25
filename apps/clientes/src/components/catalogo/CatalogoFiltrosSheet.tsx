"use client";

import { useCallback, useState } from "react";
import { Badge, Button, Dialog, Divider, Select } from "@myd-org/ui";
import type { Facetas } from "@/lib/catalog";
import { cambiarBorrador, hrefAlAplicar, limpiarBorrador } from "@/lib/catalogo-borrador";
import type { EstadoCatalogo, OrdenCatalogo } from "@/lib/catalogo-url";
import { ORDENES, contarFiltrosActivos, etiquetaBotonFiltros } from "@/lib/catalogo-vista";
import { CatalogoFiltros } from "./CatalogoFiltros";
import { useArrastrarParaCerrar } from "./useArrastrarParaCerrar";

/**
 * Filtros en mobile (debajo de `lg`): botón "Filtros (n)" que abre una hoja
 * (`Dialog placement="sheet"` del DS) con el orden y el MISMO panel que el
 * aside. El orden está adentro porque afuera, en un teléfono, no entra al lado
 * de la vista; en desktop sigue en los controles de la grilla.
 *
 * Adentro de la hoja los toques no navegan: van a un borrador local,
 * sembrado desde la URL cada vez que se abre, y "Aplicar" hace una sola
 * navegación (ver src/lib/catalogo-borrador.ts). Cerrar con la X, `Escape`
 * o el fondo descarta el borrador. Los conteos y el rango son los de la URL
 * vigente.
 *
 * El foco queda atrapado en la hoja y vuelve a este botón al cerrar (lo
 * resuelve el `Dialog` del DS). En el celular también se cierra arrastrándola
 * hacia abajo (ver useArrastrarParaCerrar), igual que con la X.
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
  const [ancla, setAncla] = useState<HTMLDivElement | null>(null);
  const cerrar = useCallback(() => setAbierto(false), []);
  useArrastrarParaCerrar(ancla, cerrar);

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
        className="hoja-arrastrable"
        title="Filtros y orden"
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
        <div ref={setAncla} className="flex flex-col gap-5">
          {/* El orden vive acá y no afuera: en un teléfono no hay lugar para
              tenerlo al lado de la vista, y cambia los resultados igual que un
              filtro, así que entra en la misma tanda de "Aplicar". No suma al
              contador del botón ni lo toca "Limpiar filtros": no es un filtro. */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Ordenar por
            </h3>
            <Select
              options={ORDENES}
              value={borrador.orden}
              onValueChange={(v) =>
                setBorrador((b) => cambiarBorrador(b, { orden: v as OrdenCatalogo }))
              }
              aria-label="Ordenar productos"
            />
          </section>
          <Divider />
          <CatalogoFiltros
            dentroDeSheet
            facetas={facetas}
            estado={borrador}
            ir={(cambios) => setBorrador((b) => cambiarBorrador(b, cambios))}
          />
        </div>
      </Dialog>
    </>
  );
}
