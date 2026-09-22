"use client";

import { Button, Chip } from "@myd-org/ui";
import type { EstadoCatalogo, RangoPrecio } from "@/lib/catalogo-url";
import { chipsActivos, limpiarFiltros } from "@/lib/catalogo-vista";

/**
 * Filtros activos como chips removibles + "Limpiar filtros", debajo del
 * encabezado. Sin filtros no devuelve nada — ni el nodo ni su margen.
 *
 * Sólo debajo de `lg`: desde ahí el panel lateral ya muestra los tildes y los
 * chips repetirían la misma información al lado. En mobile los filtros viven
 * escondidos en una hoja, así que estos chips son lo único que dice qué está
 * aplicado sin abrirla, y la única forma de sacar uno de a uno.
 *
 * Una sola línea con scroll horizontal y no `flex-wrap`: con tres o cuatro
 * filtros puestos las filas se apilaban y se comían media pantalla del
 * teléfono, que es lo que hay que gastar en productos. El chip cortado en el
 * borde derecho es lo que avisa que hay más — por eso `shrink-0` en cada uno,
 * para que no se compriman todos hasta entrar y no quede nada sobresaliendo.
 *
 * `py-1` le da aire al anillo de foco, que si no lo recorta el `overflow`.
 */
export function CatalogoChips({
  estado,
  rango,
  ir,
}: {
  estado: EstadoCatalogo;
  rango: RangoPrecio | null;
  ir: (cambios: Partial<EstadoCatalogo>) => void;
}) {
  const chips = chipsActivos(estado, rango);
  if (chips.length === 0) return null;

  return (
    <div className="mt-4 flex items-center gap-2 overflow-x-auto py-1 lg:hidden">
      {chips.map((c) => (
        <div key={c.clave} className="shrink-0">
          <Chip variant="removable" removeLabel={c.removeLabel} onRemove={() => ir(c.cambios)}>
            {c.etiqueta}
          </Chip>
        </div>
      ))}
      <div className="shrink-0">
        <Button variant="link" size="inline" onClick={() => ir(limpiarFiltros())}>
          Limpiar filtros
        </Button>
      </div>
    </div>
  );
}
