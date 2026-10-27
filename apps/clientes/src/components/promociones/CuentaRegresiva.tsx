"use client";

import { useEffect, useRef } from "react";
import { cn } from "@myd-org/ui";
import { restante } from "@/lib/promociones/promo";
import { useAhora } from "./reloj";

const dos = (n: number) => String(n).padStart(2, "0");

/**
 * Cuenta regresiva hasta `fin`. "linea": "Termina en 3 d 04 h 12 m" (segundos en las últimas 24 h).
 * "cajas": cuatro cajas días/horas/min/seg, para la sección de la home. El reloj existe recién en el
 * cliente (sin mismatch de hidratación): antes, la línea no se dibuja y las cajas muestran "--".
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
  variante?: "linea" | "cajas";
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

  if (variante === "cajas") {
    if (r === null) return null;
    const cajas = [
      { valor: r ? String(r.d) : "--", unidad: "días" },
      { valor: r ? dos(r.h) : "--", unidad: "horas" },
      { valor: r ? dos(r.m) : "--", unidad: "min" },
      { valor: r ? dos(r.s) : "--", unidad: "seg" },
    ];
    return (
      <div className={cn("flex gap-2", className)} role="timer" aria-label="Tiempo que falta para que termine la promo">
        {cajas.map((c) => (
          <div key={c.unidad} className="flex min-w-[64px] flex-col items-center rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15">
            <span className="font-display text-[clamp(24px,3vw,34px)] font-bold leading-none tabular-nums text-white">{c.valor}</span>
            <span className="mt-1 text-[11px] text-white/70">{c.unidad}</span>
          </div>
        ))}
      </div>
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
