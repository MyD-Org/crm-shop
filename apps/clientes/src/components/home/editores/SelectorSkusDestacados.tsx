"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Input, SearchInput, Spinner } from "@myd-org/ui";
import { buscarProductosHome, type ProductoBusqueda } from "@/lib/home-acciones";
import { ListaEditable } from "../ListaEditable";

const DEBOUNCE_MS = 300;
const ERROR_BUSQUEDA = "No se pudo buscar productos. Inténtelo de nuevo.";

/**
 * Selector de SKUs curados para "Destacados" (rebanada D, opcional): busca en
 * el espejo del catálogo (`buscarProductosHome`, server action que exige
 * admin) y arma con los resultados una lista reordenable de SKUs. El orden
 * de la lista es el que `elegirDestacados` (src/lib/destacados.ts) respeta al
 * armar la grilla; un SKU que ya no existe en el catálogo simplemente no
 * aparece con nombre/foto (se muestra el código crudo) y la home lo salta sin
 * romperse.
 *
 * Los resultados de cada búsqueda se acumulan en un cache local (`sku` →
 * nombre/foto) para poder mostrar nombre y foto de los SKUs ya elegidos aunque
 * el cuadro de búsqueda ya no los tenga entre sus resultados vigentes.
 */
export function SelectorSkusDestacados({ skus, onChange }: { skus: string[]; onChange: (skus: string[]) => void }) {
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<ProductoBusqueda[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, ProductoBusqueda>>({});

  const consultaVigente = busqueda.trim().length > 0;

  // El `setState` corre dentro del callback del timer (una suscripción a un
  // sistema externo, el reloj), no de forma síncrona en el cuerpo del efecto:
  // por eso `setCargando`/`setError`/`setResultados` no disparan el lint de
  // "set-state-in-effect". Con búsqueda vacía no se agenda nada; la UI se
  // deriva de `consultaVigente` en el render, sin necesidad de resetear estado.
  useEffect(() => {
    const q = busqueda.trim();
    if (!q) return;
    let vigente = true;
    const id = setTimeout(() => {
      setCargando(true);
      buscarProductosHome(q)
        .then((r) => {
          if (!vigente) return;
          setCargando(false);
          if (!r.ok) {
            setError(r.errores.join(" "));
            setResultados([]);
            return;
          }
          setError(null);
          setResultados(r.productos);
          setCache((prev) => {
            const copia = { ...prev };
            for (const p of r.productos) copia[p.sku] = p;
            return copia;
          });
        })
        .catch(() => {
          if (!vigente) return;
          setCargando(false);
          setError(ERROR_BUSQUEDA);
        });
    }, DEBOUNCE_MS);
    return () => {
      vigente = false;
      clearTimeout(id);
    };
  }, [busqueda]);

  function agregar(sku: string) {
    if (skus.includes(sku)) return;
    onChange([...skus, sku]);
  }

  const disponibles = consultaVigente ? resultados.filter((p) => !skus.includes(p.sku)) : [];

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        value={busqueda}
        onValueChange={setBusqueda}
        onClear={() => setBusqueda("")}
        placeholder="Buscar producto por nombre o SKU"
      />
      {consultaVigente && cargando ? <Spinner /> : null}
      {consultaVigente && error ? <Alert tone="danger">{error}</Alert> : null}
      {disponibles.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {disponibles.map((p) => (
            <li
              key={p.sku}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-2"
            >
              <div className="flex items-center gap-2">
                {p.foto ? (
                  // eslint-disable-next-line @next/next/no-img-element -- foto del catálogo, tamaño fijo chico
                  <img src={p.foto} alt="" className="h-10 w-10 rounded object-cover" />
                ) : null}
                <div>
                  <p className="text-sm font-medium text-text">{p.nombre}</p>
                  <p className="text-xs text-muted">{p.sku}</p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => agregar(p.sku)}>
                Agregar
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <p className="mb-2 text-sm font-semibold text-text">Productos elegidos, en este orden</p>
        <ListaEditable
          items={skus}
          onChange={onChange}
          nuevo={() => ""}
          etiquetaAgregar="Agregar SKU manualmente"
          renderItem={(sku, onItem) =>
            cache[sku] ? (
              <div className="flex items-center gap-2">
                {cache[sku].foto ? (
                  // eslint-disable-next-line @next/next/no-img-element -- foto del catálogo, tamaño fijo chico
                  <img src={cache[sku].foto} alt="" className="h-10 w-10 rounded object-cover" />
                ) : null}
                <div>
                  <p className="text-sm font-medium text-text">{cache[sku].nombre}</p>
                  <p className="text-xs text-muted">{sku}</p>
                </div>
              </div>
            ) : (
              <Input value={sku} onChange={(e) => onItem(e.target.value)} placeholder="SKU (por ejemplo ADM-D8-BCO-CO)" />
            )
          }
        />
      </div>
    </div>
  );
}
