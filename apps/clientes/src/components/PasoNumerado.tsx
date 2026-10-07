import type { ReactNode } from "react";

/**
 * Un paso de una lista numerada (`<ol>`): círculo con el número —o un tilde cuando ya está hecho—,
 * título y contenido. Lo usa "Transfiera para confirmar su pedido".
 */
export function PasoNumerado({
  numero,
  titulo,
  hecho = false,
  children,
}: {
  numero: number;
  titulo: string;
  hecho?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden="true"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          hecho ? "bg-success text-on-primary" : "bg-primary text-on-primary"
        }`}
      >
        {hecho ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 5 5 9-10" />
          </svg>
        ) : (
          numero
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
        <h2 className="text-base font-bold text-text">
          {hecho && <span className="sr-only">Hecho: </span>}
          {titulo}
        </h2>
        {children}
      </div>
    </li>
  );
}
