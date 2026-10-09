"use client";

import { useState } from "react";
import { Badge, Button, Dialog, Divider, Select } from "@myd-org/ui";
import type { Facetas } from "@/lib/catalog";
import {
  cambiarBorrador,
  hrefAlAplicar,
  hrefAlElegirCategoria,
  limpiarBorrador,
} from "@/lib/catalogo-borrador";
import { hrefCatalogo, type EstadoCatalogo, type OrdenCatalogo } from "@/lib/catalogo-url";
import { ordenesPara, contarFiltrosActivos, etiquetaBotonFiltros } from "@/lib/catalogo-vista";
import { CatalogoFiltros } from "./CatalogoFiltros";
import { useAlOcultar } from "@/lib/use-al-ocultar";

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
 * Con las facetas por tipo prendidas, elegir o quitar una categoría SÍ se aplica en el acto: los
 * filtros por tipo de producto dependen de ella y hay que traerlos. Navega con el borrador completo
 * (sin las características de la categoría anterior), la hoja sigue abierta con `aria-busy` y, cuando
 * llega el estado nuevo, el borrador se vuelve a sembrar para mostrar los filtros de la categoría
 * nueva sin reabrirla. Con el flag apagado queda como siempre.
 *
 * El foco queda atrapado en la hoja y vuelve a este botón al cerrar (lo
 * resuelve el `Dialog` del DS). En el celular también se cierra arrastrándola
 * hacia abajo (lo trae la hoja del DS desde 0.27.0), igual que con la X.
 */
export function CatalogoFiltrosSheet({
  facetas,
  estado,
  navegar,
  navegando = false,
}: {
  facetas: Facetas;
  /** Estado vigente (la URL). */
  estado: EstadoCatalogo;
  /** Navega a una URL del catálogo (el padre la envuelve en una transición). */
  navegar: (href: string) => void;
  /** Hay una navegación en curso (la categoría recién elegida está cargando). */
  navegando?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState(estado);
  // Cuando llega una URL nueva (la de la categoría recién elegida), el borrador se vuelve a sembrar:
  // ya incluye todo lo que se había tocado en la hoja, y ahora con los filtros de la categoría nueva.
  // Ajuste de estado durante el render (patrón de React), no en un efecto: sin un cuadro con lo viejo.
  const claveEstado = hrefCatalogo(estado);
  const [claveSembrada, setClaveSembrada] = useState(claveEstado);
  if (claveSembrada !== claveEstado) {
    setClaveSembrada(claveEstado);
    setBorrador(estado);
  }
  // Al salir del catálogo la hoja se cierra (y el borrador se descarta, igual
  // que con la X): al volver, los filtros son los de la URL.
  useAlOcultar(() => setAbierto(false));
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

  // La hoja sigue abierta: sólo navega (si hay algo que aplicar) y espera la respuesta.
  const alElegirCategoria = (categorias: string[]) => {
    const href = hrefAlElegirCategoria(estado, borrador, categorias);
    if (href) navegar(href);
  };

  return (
    <>
      <Button
        variant="outline"
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
        title="Filtros y orden"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBorrador(limpiarBorrador(borrador))}>
              Limpiar filtros
            </Button>
            <Button variant="primary" onClick={aplicar} disabled={navegando}>
              Aplicar
            </Button>
          </>
        }
      >
        {/* Mientras carga la categoría elegida el contenido se atenúa y no recibe toques: lo que se
            tocara se perdería al resembrar el borrador. */}
        <div
          className="flex flex-col gap-5 transition-opacity aria-busy:pointer-events-none aria-busy:opacity-60"
          aria-busy={navegando}
        >
          {/* El orden vive acá y no afuera: en un teléfono no hay lugar para
              tenerlo al lado de la vista, y cambia los resultados igual que un
              filtro, así que entra en la misma tanda de "Aplicar". No suma al
              contador del botón ni lo toca "Limpiar filtros": no es un filtro. */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Ordenar por
            </h3>
            <Select
              options={ordenesPara(borrador)}
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
            alElegirCategoria={alElegirCategoria}
          />
        </div>
      </Dialog>
    </>
  );
}
