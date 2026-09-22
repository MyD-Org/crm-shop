"use client";

import { Button, Chip } from "@myd-org/ui";
import type { EstadoCatalogo, RangoPrecio } from "@/lib/catalogo-url";
import { chipsActivos, limpiarFiltros } from "@/lib/catalogo-vista";

/** Filtros activos como chips removibles + "Limpiar filtros". Sin filtros no se muestra. */
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
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <Chip
          key={c.clave}
          variant="removable"
          removeLabel={c.removeLabel}
          onRemove={() => ir(c.cambios)}
        >
          {c.etiqueta}
        </Chip>
      ))}
      <Button variant="link" size="inline" onClick={() => ir(limpiarFiltros())}>
        Limpiar filtros
      </Button>
    </div>
  );
}
