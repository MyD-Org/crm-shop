"use client";

import { useRef, useState } from "react";

/** La misma query con `start` (0 = sin `start`). */
function conStart(query: string, start: number): string {
  const params = new URLSearchParams(query);
  if (start > 0) params.set("start", String(start));
  const q = params.toString();
  return q ? `?${q}` : "";
}

/**
 * Lista paginada contra una API de cuenta corriente (`/api/mi-cuenta/pagos`,
 * `/api/mi-cuenta/presupuestos`): la primera página viene del servidor, "Cargar
 * más" agrega la siguiente del filtro CARGADO debajo y un filtro nuevo
 * reemplaza la lista. Sólo la última consulta pinta: un filtro rápido no queda
 * tapado por una respuesta vieja.
 *
 * Un filtro se identifica por su query sin página (`""` = sin filtros, el de la
 * primera página del servidor).
 */
export function usePaginaApi<T>({
  ruta,
  campo,
  inicial,
  errorCarga,
}: {
  ruta: string;
  /** Propiedad de la respuesta con las filas: `{ [campo]: T[], total }`. */
  campo: string;
  inicial: { items: T[]; total: number };
  errorCarga: string;
}) {
  const [items, setItems] = useState<T[]>(inicial.items);
  const [total, setTotal] = useState(inicial.total);
  const [cargada, setCargada] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ultima = useRef(0);

  async function pedir(query: string, start: number) {
    const id = ++ultima.current;
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`${ruta}${conStart(query, start)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (id !== ultima.current) return;
      const filas = body?.[campo];
      if (!res.ok || !Array.isArray(filas)) {
        setError(typeof body?.error === "string" ? body.error : errorCarga);
        return;
      }
      setItems((prev) => (start === 0 ? (filas as T[]) : [...prev, ...(filas as T[])]));
      setTotal(typeof body?.total === "number" ? body.total : 0);
      setCargada(query);
    } catch {
      if (id === ultima.current) setError(errorCarga);
    } finally {
      if (id === ultima.current) setCargando(false);
    }
  }

  return {
    items,
    total,
    cargando,
    error,
    /** Siguiente página del filtro cargado. */
    cargarMas: () => void pedir(cargada, items.length),
    /** Vuelve a pedir la primera página del filtro cargado (p. ej. tras informar un pago). */
    recargar: () => void pedir(cargada, 0),
    /** Aplica un filtro (su query sin `start`); si es el ya cargado no pide nada. */
    filtrar: (query: string) => {
      const q = query.replace(/^\?/, "");
      if (q === cargada) {
        // Volvió al filtro cargado: una consulta en vuelo de otro filtro ya no pinta.
        ultima.current++;
        setCargando(false);
        setError(null);
        return;
      }
      void pedir(q, 0);
    },
  };
}
