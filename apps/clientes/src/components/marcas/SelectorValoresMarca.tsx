"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Checkbox, Input, Spinner } from "@myd-org/ui";
import { valoresMarcaParaEditor } from "@/lib/marcas/marcas-acciones";

type Valor = { valor: string; count: number };

/**
 * Elige qué valores de marca del catálogo son esta marca (spec §1). Nunca se
 * tipean: la lista sale del catálogo real (`valoresMarcaParaEditor`, sin stock
 * ni zona). Los elegidos que ya no existen en el catálogo (los renombraron en
 * Alegra) se muestran marcados "sin productos" para que se corrijan.
 */
export function SelectorValoresMarca({
  elegidos,
  onChange,
}: {
  elegidos: string[];
  onChange: (valores: string[]) => void;
}) {
  const [valores, setValores] = useState<Valor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    let vigente = true;
    valoresMarcaParaEditor().then(
      (r) => {
        if (!vigente) return;
        if (r.ok) setValores(r.valores);
        else setError(r.error);
      },
      () => vigente && setError("No pudimos leer las marcas del catálogo. Inténtelo nuevamente."),
    );
    return () => {
      vigente = false;
    };
  }, []);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!valores) return <Spinner label="Cargando las marcas del catálogo" />;

  const existentes = new Set(valores.map((v) => v.valor));
  const huerfanos = elegidos.filter((e) => !existentes.has(e)).map((valor) => ({ valor, count: 0 }));
  const q = filtro.trim().toLowerCase();
  const visibles = [...huerfanos, ...valores].filter(
    (v) => elegidos.includes(v.valor) || !q || v.valor.toLowerCase().includes(q),
  );
  const alternar = (valor: string, marcado: boolean) =>
    onChange(marcado ? [...elegidos, valor] : elegidos.filter((e) => e !== valor));

  return (
    <div className="flex flex-col gap-2">
      <Input placeholder="Buscar marca" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Buscar marca" />
      <ul className="max-h-60 overflow-y-auto rounded-md border border-border">
        {visibles.slice(0, 80).map((v) => (
          <li key={v.valor} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
            <Checkbox
              id={`valor-${v.valor}`}
              checked={elegidos.includes(v.valor)}
              onCheckedChange={(m) => alternar(v.valor, m)}
              aria-label={v.valor}
            />
            <label htmlFor={`valor-${v.valor}`} className="flex-1 text-sm text-text">
              {v.valor}
            </label>
            {v.count > 0 ? (
              <span className="text-xs text-muted">{v.count} productos</span>
            ) : (
              <Badge tone="warning">Sin productos</Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
