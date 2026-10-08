"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, PaymentLogos, Spinner } from "@myd-org/ui";
import type { TarjetasAceptadas } from "@/lib/pagos/tarjetas-aceptadas";

/**
 * "Ver tarjetas aceptadas" + modal con los logos (crédito o débito, según la opción elegida). La lista se pide
 * recién al abrir (`/api/pagos/tarjetas`, cacheada en el servidor): el checkout no la paga si nadie la mira.
 */
export function TarjetasAceptadasModal({ tipo }: { tipo: "credito" | "debito" }) {
  const [abierto, setAbierto] = useState(false);
  const [tarjetas, setTarjetas] = useState<TarjetasAceptadas | null>(null);
  const [error, setError] = useState(false);
  // Dialog controlado y sin `Trigger`: el foco vuelve al botón a mano (como `MediosDePagoModal`).
  const botonRef = useRef<HTMLButtonElement>(null);
  const cambiarAbierto = (abrir: boolean) => {
    setAbierto(abrir);
    if (!abrir) requestAnimationFrame(() => botonRef.current?.focus());
  };

  useEffect(() => {
    if (!abierto || tarjetas) return;
    let vigente = true;
    setError(false);
    fetch("/api/pagos/tarjetas")
      .then((r) => (r.ok ? (r.json() as Promise<TarjetasAceptadas>) : Promise.reject(new Error(String(r.status)))))
      .then((t) => vigente && setTarjetas(t))
      .catch(() => vigente && setError(true));
    return () => {
      vigente = false;
    };
  }, [abierto, tarjetas]);

  const lista = tarjetas?.[tipo] ?? [];

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        className="self-start text-sm font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        Ver tarjetas aceptadas
      </button>
      <Dialog
        open={abierto}
        onOpenChange={cambiarAbierto}
        title={tipo === "debito" ? "Tarjetas de débito aceptadas" : "Tarjetas de crédito aceptadas"}
        size="md"
      >
        {error ? (
          <p className="text-sm text-muted">No pudimos cargar la lista. Inténtelo de nuevo en unos minutos.</p>
        ) : !tarjetas ? (
          <div className="flex justify-center py-6">
            <Spinner label="Cargando las tarjetas" />
          </div>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted">No pudimos cargar la lista. Inténtelo de nuevo en unos minutos.</p>
        ) : (
          <PaymentLogos variant="labeled" logos={lista.map((t) => ({ name: t.nombre, src: t.logo }))} />
        )}
      </Dialog>
    </>
  );
}
