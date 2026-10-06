"use client";

import { Chip } from "@myd-org/ui";
import type { EstadoCatalogo, RangoPrecio } from "@/lib/catalogo-url";
import { chipsActivos } from "@/lib/catalogo-vista";

/**
 * Filtros activos como chips removibles, debajo del encabezado. Sin filtros no
 * devuelve nada — ni el nodo ni su margen.
 *
 * Sin "Limpiar filtros" en la fila: cada chip ya tiene su `×`, y borrar todo
 * de una sigue estando en el pie de la hoja de filtros. Al final de una fila
 * que scrollea, además, quedaba fuera de pantalla en cuanto había tres o
 * cuatro chips.
 *
 * También en desktop: el panel lateral muestra los tildes, pero no todo lo
 * aplicado se ve ahí (el local de "Con stock en" queda al pie del panel, y un
 * local recordado por cookie puede estar puesto sin que el visitante lo haya
 * elegido). El chip es lo que lo dice a primera vista, arriba de la grilla. En
 * mobile los filtros viven escondidos en una hoja, así que estos chips son lo
 * único que dice qué está aplicado sin abrirla.
 *
 * En mobile, una sola línea con scroll horizontal y no `flex-wrap`: con tres o
 * cuatro filtros puestos las filas se apilaban y se comían media pantalla del
 * teléfono, que es lo que hay que gastar en productos. El chip cortado en el
 * borde derecho es lo que avisa que hay más — por eso `shrink-0` en cada uno,
 * para que no se compriman todos hasta entrar y no quede nada sobresaliendo.
 * Desde `lg` hay ancho de sobra: envuelven en varias filas.
 *
 * `py-1` le da aire al anillo de foco, que si no lo recorta el `overflow`.
 */
export function CatalogoChips({
  estado,
  rango,
  locales,
  ir,
  sinInterpretados = false,
}: {
  estado: EstadoCatalogo;
  rango: RangoPrecio | null;
  /** Locales del filtro "Con stock en": ponen el nombre en el chip. */
  locales?: { slug: string; nombre: string }[];
  ir: (cambios: Partial<EstadoCatalogo>) => void;
  /**
   * Categorías y atributos ya se muestran en la franja "Entendimos" (búsqueda
   * interpretada): acá quedan sólo los demás filtros, para no repetirlos.
   */
  sinInterpretados?: boolean;
}) {
  const chips = chipsActivos(estado, rango, locales).filter(
    (c) => !sinInterpretados || !/^(categoria|atributo):/.test(c.clave),
  );
  if (chips.length === 0) return null;

  return (
    <div className="mt-4 flex items-center gap-2 overflow-x-auto py-1 lg:flex-wrap lg:overflow-visible">
      {chips.map((c) => (
        <div key={c.clave} className="shrink-0">
          <Chip variant="removable" removeLabel={c.removeLabel} onRemove={() => ir(c.cambios)}>
            {c.etiqueta}
          </Chip>
        </div>
      ))}
    </div>
  );
}
