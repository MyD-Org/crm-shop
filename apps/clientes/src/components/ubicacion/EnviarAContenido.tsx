import type { LineasEnviarA } from "@/lib/enviar-a";

/**
 * Contenido del botón "Enviar a" del header: ícono + etiqueta + valor. En desktop va en dos líneas
 * (`text-xs leading-4` cada una: el bloque mide lo mismo que el fallback `h-8`, sin CLS); en la
 * línea de mobile (bajo el buscador), en una sola ("Retirar en Mar del Plata"). El valor se trunca con elipsis.
 * Presentacional: sin estado ni datos.
 */
export function EnviarAContenido({ lineas, enLinea = false }: { lineas: LineasEnviarA; enLinea?: boolean }) {
  return (
    <span className="flex min-w-0 max-w-full items-center gap-1.5 text-left">
      {lineas.retiro ? <IconoLocal /> : <IconoPin />}
      <span className={enLinea ? "flex min-w-0 items-baseline gap-1" : "flex min-w-0 flex-col"}>
        <span className="block shrink-0 truncate text-xs font-normal leading-4 text-muted">{lineas.etiqueta}</span>
        <span className="flex min-w-0 items-center gap-0.5 text-xs font-semibold leading-4 text-text">
          <span className="truncate">{lineas.valor}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </span>
    </span>
  );
}

function IconoPin() {
  return (
    <svg data-icono="pin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted">
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function IconoLocal() {
  return (
    <svg data-icono="local" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" />
      <path d="M5 13v7h14v-7" />
      <path d="M10 20v-4h4v4" />
    </svg>
  );
}
