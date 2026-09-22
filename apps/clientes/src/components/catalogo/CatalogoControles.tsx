"use client";

import { SegmentedControl, Select } from "@myd-org/ui";
import type { EstadoCatalogo, OrdenCatalogo, VistaCatalogo } from "@/lib/catalogo-url";
import { ORDENES } from "@/lib/catalogo-vista";
import { GridIcon, ListIcon } from "./iconos";

const VISTAS = [
  { value: "grilla", icon: <GridIcon />, ariaLabel: "Vista en grilla" },
  { value: "lista", icon: <ListIcon />, ariaLabel: "Vista en lista" },
];

/**
 * Vista (grilla/lista) y orden. Viven pegados a la grilla y no al título:
 * actúan sobre los resultados, no sobre la página. Por eso quedaron en la
 * columna de resultados cuando el encabezado pasó a ocupar todo el ancho.
 */
export function CatalogoControles({
  estado,
  ir,
}: {
  estado: EstadoCatalogo;
  ir: (cambios: Partial<EstadoCatalogo>) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <SegmentedControl
        ariaLabel="Vista"
        options={VISTAS}
        value={estado.vista}
        // Cambiar la vista no cambia los resultados: se queda en la página.
        onValueChange={(v) => ir({ vista: v as VistaCatalogo, pagina: estado.pagina })}
      />
      {/* Debajo de lg el orden se elige adentro de la hoja de filtros, junto
          con todo lo demás que cambia los resultados; acá afuera queda sólo la
          vista, que no los cambia. */}
      <div className="hidden lg:block">
        <Select
          options={ORDENES}
          value={estado.orden}
          onValueChange={(v) => ir({ orden: v as OrdenCatalogo })}
          aria-label="Ordenar productos"
          className="w-52"
        />
      </div>
    </div>
  );
}
