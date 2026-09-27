import type { EspecificacionProducto } from "@/data/products";

/**
 * Tabla de datos técnicos de la ficha (etiqueta a la izquierda, valor a la
 * derecha). Hoy ningún producto trae especificaciones: sin filas no dibuja
 * nada, así que queda listo para cuando el CRM las cargue.
 */
export function EspecificacionesProducto({ filas }: { filas?: EspecificacionProducto[] }) {
  const conDatos = (filas ?? []).filter((f) => f.etiqueta.trim() && f.valor.trim());
  if (conDatos.length === 0) return null;

  return (
    <section aria-labelledby="especificaciones-titulo">
      <h2 id="especificaciones-titulo" className="mb-3 font-display text-lg font-semibold text-text">
        Especificaciones
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
