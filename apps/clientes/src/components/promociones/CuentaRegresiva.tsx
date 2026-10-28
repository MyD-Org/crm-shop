"use client";

import { useEffect, useRef } from "react";
import { cn } from "@myd-org/ui";
import { fechaCortaAR, restante } from "@/lib/promociones/promo";
import { useAhora } from "./reloj";

const dos = (n: number) => String(n).padStart(2, "0");

/**
 * Cuenta regresiva hasta `fin`. "linea": "Termina en 3 d 04 h 12 m" (segundos en las últimas 24 h).
 * "pastilla": una pastilla con reloj para el encabezado de la home. El reloj existe recién en el
 * cliente (sin mismatch de hidratación): antes, la línea no se dibuja y la pastilla dice la fecha.
 * Al llegar a cero llama a `onFin` una sola vez.
 */
export function CuentaRegresiva({
  fin,
  onFin,
  className,
  variante = "linea",
}: {
  fin: string;
  onFin?: () => void;
  className?: string;
  variante?: "linea" | "pastilla";
}) {
  const ahora = useAhora();
  const avisado = useRef(false);

  const r = ahora === null ? undefined : restante(fin, ahora);
  useEffect(() => {
    if (r === null && !avisado.current) {
      avisado.current = true;
      onFin?.();
    }
  }, [r, onFin]);

  if (variante === "pastilla") {
    if (r === null) return null;
    return (
      <p
        role="timer"
        aria-live="off"
        className={cn("inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-sm text-white ring-1 ring-white/15", className)}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 text-white/80" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        {/* Sin reloj (servidor e hidratación): la fecha; en el cliente, la cuenta. Mismo ancho aprox., sin salto. */}
        {r ? (
          <span className="tabular-nums">
            Termina en <span className="font-semibold">{`${r.d} d ${dos(r.h)} h ${dos(r.m)} m ${dos(r.s)} s`}</span>
          </span>
        ) : (
          <span>
            Termina el <span className="font-semibold">{fechaCortaAR(fin)}</span>
          </span>
        )}
      </p>
    );
  }

  if (!r) return null;
  const partes = [r.d > 0 ? `${r.d} d` : null, `${dos(r.h)} h`, `${dos(r.m)} m`, r.d === 0 ? `${dos(r.s)} s` : null].filter(Boolean);
  return (
    <p className={cn("tabular-nums", className)} aria-live="off">
      Termina en <span className="font-semibold">{partes.join(" ")}</span>
    </p>
  );
}
