"use client";

import type { ReactNode } from "react";
import { Button } from "@myd-org/ui";
import type { SoloEn } from "@/data/home-defaults";
import { agregarItem, moverItem, quitarItem } from "@/lib/home-editor";
import { SelectorVisibilidad } from "./editores/SelectorVisibilidad";

function FlechaArribaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
function FlechaAbajoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  );
}
function QuitarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * Lista genérica editable (subir/bajar/quitar/agregar), usada por los
 * editores de sección (`ctas`, `usps`, `marquee.items`, tiles, chips,
 * `servicios.items`, `destacados.imagenes`).
 *
 * Con `conVisibilidad` cada ítem lleva su "Mostrar" (siempre / solo desktop /
 * solo mobile / nunca), guardado en `item.visibilidad`.
 */
export function ListaEditable<T>({
  items,
  onChange,
  renderItem,
  nuevo,
  etiquetaAgregar = "Agregar",
  min = 0,
  conVisibilidad = false,
  nombreItem = "ítem",
}: {
  items: readonly T[];
  onChange: (items: T[]) => void;
  renderItem: (item: T, onItem: (v: T) => void, i: number) => ReactNode;
  nuevo: () => T;
  etiquetaAgregar?: string;
  min?: number;
  /** Sólo para ítems objeto con `visibilidad?: SoloEn`. */
  conVisibilidad?: boolean;
  /** Cómo se llama cada ítem en el nombre accesible del selector ("botón 2"). */
  nombreItem?: string;
}) {
  const reemplazar = (i: number, v: T) => {
    const copia = [...items];
    copia[i] = v;
    onChange(copia);
  };
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg border border-border p-3">
          <div className="flex flex-1 flex-col gap-3">
            {renderItem(item, (v) => reemplazar(i, v), i)}
            {conVisibilidad ? (
              <SelectorVisibilidad
                ariaLabel={`Dónde se muestra: ${nombreItem} ${i + 1}`}
                valor={(item as { visibilidad?: SoloEn }).visibilidad}
                onChange={(visibilidad) => reemplazar(i, { ...item, visibilidad } as T)}
              />
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Subir"
              disabled={i === 0}
              onClick={() => onChange(moverItem(items, i, -1))}
            >
              <FlechaArribaIcon />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Bajar"
              disabled={i === items.length - 1}
              onClick={() => onChange(moverItem(items, i, 1))}
            >
              <FlechaAbajoIcon />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Quitar"
              disabled={items.length <= min}
              onClick={() => onChange(quitarItem(items, i))}
            >
              <QuitarIcon />
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange(agregarItem(items, nuevo()))}>
        {etiquetaAgregar}
      </Button>
    </div>
  );
}
