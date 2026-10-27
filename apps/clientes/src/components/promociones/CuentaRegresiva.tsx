"use client";

import { useEffect, useRef } from "react";
import { cn } from "@myd-org/ui";
import { restante } from "@/lib/promociones/promo";
import { useAhora } from "./reloj";

const dos = (n: number) => String(n).padStart(2, "0");

/**
 * "Termina en 3 d 04 h 12 m" (con segundos en las últimas 24 h). Se dibuja recién en el cliente:
 * en el servidor (y en el primer render) no hay reloj, así no hay mismatch de hidratación. Al llegar
 * a cero llama a `onFin` una sola vez.
 */
export function CuentaRegresiva({ fin, onFin, className }: { fin: string; onFin?: () => void; className?: string }) {
  const ahora = useAhora();
  const avisado = useRef(false);

  const r = ahora === null ? undefined : restante(fin, ahora);
  useEffect(() => {
    if (r === null && !avisado.current) {
      avisado.current = true;
      onFin?.();
    }
  }, [r, onFin]);

  if (!r) return null;
  const partes = [r.d > 0 ? `${r.d} d` : null, `${dos(r.h)} h`, `${dos(r.m)} m`, r.d === 0 ? `${dos(r.s)} s` : null].filter(Boolean);
  return (
    <p className={cn("tabular-nums", className)} aria-live="off">
      Termina en <span className="font-semibold">{partes.join(" ")}</span>
    </p>
  );
}
