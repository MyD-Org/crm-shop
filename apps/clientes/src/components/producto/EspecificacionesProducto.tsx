import type { EspecificacionProducto } from "@/data/products";

/**
 * Tabla "Características" de la ficha (etiqueta a la izquierda, valor a la
 * derecha), con los datos técnicos estructurados del CRM (`catalog_atributos`:
 * potencia, tono, zócalo…; ver catalogo-caracteristicas.ts). Sin filas no
 * dibuja nada: llegan sólo con el flag `busqueda-ia` y la tabla del CRM.
 */
export function EspecificacionesProducto({ filas }: { filas?: EspecificacionProducto[] }) {
  const conDatos = (filas ?? []).filter((f) => f.etiqueta.trim() && f.valor.trim());
  if (conDatos.length === 0) return null;

  return (
    <section aria-labelledby="especificaciones-titulo">
      <h2 id="especificaciones-titulo" className="mb-3 font-display text-lg font-semibold text-text">
        Características
      </h2>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] border-t border-border text-sm">
        {conDatos.map((f) => (
          <div key={f.etiqueta} className="contents">
            <dt className="border-b border-border py-2.5 pr-8 text-muted">{f.etiqueta}</dt>
            <dd className="border-b border-border py-2.5 font-semibold text-text">{f.valor}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
