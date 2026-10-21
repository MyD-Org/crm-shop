"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Checkbox, Spinner } from "@myd-org/ui";
import { formatRubro } from "@/lib/formato-rubro";

/** Las elegidas que no están entre las categorías del catálogo (por nombre guardado, exacto). */
export function categoriasDesconocidas(elegidas: readonly string[], disponibles: readonly string[]): string[] {
  const hay = new Set(disponibles);
  return elegidas.filter((c) => !hay.has(c));
}

/**
 * Categorías de una línea de una página de marca: casillas sobre las categorías reales de la
 * tienda (`/api/shop/categorias`, las mismas del menú), guardadas con su nombre real (el filtro
 * del catálogo compara exacto) y mostradas como se ven en la tienda. Controlado: el valor vive en
 * la línea, así reordenar o borrar líneas no le pasa las categorías de una a otra.
 */
export function SelectorCategoriasLinea({
  valor,
  onChange,
}: {
  valor: string[];
  onChange: (categorias: string[]) => void;
}) {
  const [disponibles, setDisponibles] = useState<string[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vigente = true;
    fetch("/api/shop/categorias")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { categorias: string[] }) => vigente && setDisponibles(d.categorias))
      .catch(() => vigente && setError(true));
    return () => {
      vigente = false;
    };
  }, []);

  if (error) return <Alert tone="danger">No se pudieron cargar las categorías. Inténtelo de nuevo.</Alert>;
  if (!disponibles) return <Spinner label="Cargando las categorías" />;

  const faltan = categoriasDesconocidas(valor, disponibles);
  const alternar = (c: string, marcada: boolean) => onChange(marcada ? [...valor, c] : valor.filter((v) => v !== c));
  return (
    <ul className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
      {[...faltan, ...disponibles].map((c) => (
        <li key={c} className="flex items-center gap-2 px-1 py-1">
          <Checkbox checked={valor.includes(c)} onCheckedChange={(m) => alternar(c, m)} aria-label={formatRubro(c)} />
          <span className="text-sm text-text">{formatRubro(c)}</span>
          {faltan.includes(c) ? <Badge tone="warning">Ya no existe</Badge> : null}
        </li>
      ))}
    </ul>
  );
}
