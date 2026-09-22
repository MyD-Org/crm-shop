"use client";

import { Breadcrumb, SegmentedControl, Select } from "@myd-org/ui";
import type { EstadoCatalogo, OrdenCatalogo, VistaCatalogo } from "@/lib/catalogo-url";
import { contadorProductos, migas, tituloCatalogo } from "@/lib/catalogo-vista";
import { GridIcon, ListIcon } from "./iconos";
import { linkNext } from "./link-next";

// Sin "Más vendidos": nunca hubo un dato de ventas detrás (ordenaba por nombre).
const ORDENES: { label: string; value: OrdenCatalogo }[] = [
  { label: "Nombre A-Z", value: "nombre" },
  { label: "Precio: menor a mayor", value: "precio-asc" },
  { label: "Precio: mayor a menor", value: "precio-desc" },
];

const VISTAS = [
  { value: "grilla", icon: <GridIcon />, ariaLabel: "Vista en grilla" },
  { value: "lista", icon: <ListIcon />, ariaLabel: "Vista en lista" },
];

/** Ubicación, título, contador, vista (grilla/lista) y orden. */
export function CatalogoEncabezado({
  estado,
  total,
  paginas,
  ir,
}: {
  estado: EstadoCatalogo;
  total: number;
  paginas: number;
  ir: (cambios: Partial<EstadoCatalogo>) => void;
}) {
  return (
    <header className="flex flex-col gap-3">
      <Breadcrumb items={migas(estado)} renderLink={linkNext} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-medium tracking-tight text-text md:text-4xl">
            {tituloCatalogo(estado)}
          </h1>
          <p className="text-sm text-muted">
            {contadorProductos(total, estado.pagina, paginas)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SegmentedControl
            ariaLabel="Vista"
            options={VISTAS}
            value={estado.vista}
            // Cambiar la vista no cambia los resultados: se queda en la página.
            onValueChange={(v) => ir({ vista: v as VistaCatalogo, pagina: estado.pagina })}
          />
          <Select
            options={ORDENES}
            value={estado.orden}
            onValueChange={(v) => ir({ orden: v as OrdenCatalogo })}
            aria-label="Ordenar productos"
            className="w-52"
          />
        </div>
      </div>
    </header>
  );
}
