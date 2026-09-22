"use client";

import { useId, useState } from "react";
import { Button, Card, Divider, FacetGroup, RangeSlider, Switch } from "@myd-org/ui";
import type { Facetas } from "@/lib/catalog";
import {
  cambiosDeRango,
  rangoEfectivo,
  type EstadoCatalogo,
} from "@/lib/catalogo-url";
import { fmtPesos, hayFiltros, itemsDeFaceta, limpiarFiltros } from "@/lib/catalogo-vista";
import { formatMarca, formatRubro } from "@/lib/formato-rubro";

type Ir = (cambios: Partial<EstadoCatalogo>) => void;

/** Alterna un valor en una lista de filtros. */
const alternar = (lista: string[], valor: string, tildado: boolean) =>
  tildado ? [...lista, valor] : lista.filter((x) => x !== valor);

/**
 * Panel de filtros: categorías, marcas, precio y disponibilidad. Puro: todo
 * lo que toca el visitante sale por `ir` como cambios de estado (que el
 * padre convierte en URL). Sin `dentroDeSheet` va dentro de una `Card` con
 * "Limpiar" en el encabezado (aside de desktop); con `dentroDeSheet` se
 * renderiza pelado, para la hoja de filtros de mobile.
 */
export function CatalogoFiltros({
  facetas,
  estado,
  ir,
  dentroDeSheet = false,
}: {
  facetas: Facetas;
  estado: EstadoCatalogo;
  ir: Ir;
  dentroDeSheet?: boolean;
}) {
  // useId: el panel se monta dos veces (aside y hoja de mobile).
  const idDisponibilidad = useId();
  const grupos = (
    <div className="flex flex-col gap-5">
      <FacetGroup
        title="Categorías"
        items={itemsDeFaceta(facetas.categorias, estado.categorias).map((c) => ({
          value: c.label,
          label: formatRubro(c.label),
          count: c.count,
          checked: c.checked,
        }))}
        onToggle={(valor, tildado) =>
          ir({ categorias: alternar(estado.categorias, valor, tildado) })
        }
        emptyText="Sin categorías para estos filtros"
      />
      <Divider />
      <FacetGroup
        title="Marcas"
        items={itemsDeFaceta(facetas.marcas, estado.marcas).map((m) => ({
          value: m.label,
          label: formatMarca(m.label),
          count: m.count,
          checked: m.checked,
        }))}
        onToggle={(valor, tildado) => ir({ marcas: alternar(estado.marcas, valor, tildado) })}
        searchable
        searchPlaceholder="Buscar marca…"
        initialVisible={6}
        moreLabel="Ver todas las marcas ({n})"
        lessLabel="Ver menos"
        emptyText="Sin marcas para estos filtros"
        searchEmptyText="No hay marcas que coincidan con su búsqueda."
      />
      {facetas.precio && (
        <>
          <Divider />
          <FiltroPrecio facetas={facetas} estado={estado} ir={ir} />
        </>
      )}
      <Divider />
      <section aria-labelledby={idDisponibilidad} className="flex flex-col gap-3">
        <h3
          id={idDisponibilidad}
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          Disponibilidad
        </h3>
        <Switch
          label="Solo con stock"
          checked={estado.soloStock}
          onCheckedChange={(v) => ir({ soloStock: v })}
        />
      </section>
    </div>
  );

  if (dentroDeSheet) return grupos;

  return (
    <Card
      title="Filtros"
      action={
        hayFiltros(estado) ? (
          <Button variant="link" size="inline" onClick={() => ir(limpiarFiltros())}>
            Limpiar
          </Button>
        ) : undefined
      }
    >
      {grupos}
    </Card>
  );
}

/**
 * Slider de precio. Mientras se arrastra, el valor vive acá; la navegación
 * sale sólo al soltar (`onValueCommit`). El valor local queda atado a la
 * URL y al rango vigentes: cuando cualquiera de los dos cambia (llegó la
 * página nueva), manda de nuevo lo que dice la URL.
 */
function FiltroPrecio({
  facetas,
  estado,
  ir,
}: {
  facetas: Facetas;
  estado: EstadoCatalogo;
  ir: Ir;
}) {
  const idPrecio = useId();
  const rango = facetas.precio;
  const clave = `${estado.precioMin}|${estado.precioMax}|${rango?.min}|${rango?.max}`;
  const [arrastre, setArrastre] = useState<{ clave: string; valor: [number, number] } | null>(
    null
  );
  if (!rango) return null;

  const valor = arrastre?.clave === clave ? arrastre.valor : rangoEfectivo(estado, rango);

  return (
    <section aria-labelledby={idPrecio} className="flex flex-col gap-3">
      <h3 id={idPrecio} className="text-xs font-semibold uppercase tracking-wide text-muted">
        Precio
      </h3>
      <RangeSlider
        min={rango.min}
        max={rango.max}
        step={1}
        value={valor}
        onValueChange={(v) => setArrastre({ clave, valor: v })}
        onValueCommit={(v) => ir(cambiosDeRango(v, rango))}
        formatValue={fmtPesos}
        thumbLabels={["Precio mínimo", "Precio máximo"]}
        disabled={rango.min === rango.max}
        aria-label="Precio"
      />
    </section>
  );
}
