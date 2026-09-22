"use client";

import type { ReactNode } from "react";
import { Breadcrumb } from "@myd-org/ui";
import type { EstadoCatalogo } from "@/lib/catalogo-url";
import { migas, tituloCatalogo } from "@/lib/catalogo-vista";
import { linkNext } from "./link-next";

/**
 * Ubicación, título y acciones, a todo el ancho y por encima de las dos
 * columnas. Las acciones van en la misma línea que el `<h1>` justamente para
 * que abajo el panel de filtros y la grilla arranquen a la misma altura: si
 * cuelgan de la columna de resultados, la empujan hacia abajo y las dos
 * columnas quedan desfasadas.
 *
 * Sin la bajada de "N productos · página X de Y": "477 páginas" no le sirve a
 * nadie que esté comprando —la paginación al pie ya dice dónde está parado— y
 * el total suelto arriba del todo tampoco cambiaba ninguna decisión.
 * `contadorProductos()` sigue existiendo por si vuelve en otro lugar, y el
 * `role="status"` de `CatalogoClient` sigue anunciando los resultados a los
 * lectores de pantalla.
 */
export function CatalogoEncabezado({
  estado,
  acciones,
}: {
  estado: EstadoCatalogo;
  /** Vista, orden y —en mobile— el botón que abre la hoja de filtros. */
  acciones?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      <Breadcrumb items={migas(estado)} renderLink={linkNext} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl font-medium tracking-tight text-text md:text-4xl">
          {tituloCatalogo(estado)}
        </h1>
        {acciones}
      </div>
    </header>
  );
}
