"use client";

import { useRef, useState } from "react";
import { Dialog, PaymentLogos, type PaymentLogo } from "@myd-org/ui";
import { MediosDePagoDetalle } from "@/components/MediosDePagoDetalle";
import type { CuotasFichaCarrito } from "@/lib/ficha-cuotas-carrito";
import type { PrecioMedio, PrecioOffline } from "@/data/products";
import { preciosFormaDelModal } from "@/lib/precios-forma-modal";
import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import { filasNoAlcanzadas, opcionesCombinadas, type CuotasProducto } from "@/lib/cuotas-sin-interes";

/**
 * Botón "Ver medios de pago" + modal. El `Dialog` de @myd-org/ui es Radix:
 * foco atrapado adentro, Escape cierra, `aria-modal` + título/descripción
 * enlazados, y al cerrar devolvemos el foco a este botón.
 *
 * Los bloques se calculan recién al abrir: la ficha no paga el cálculo si nadie
 * mira el detalle.
 */
export function MediosDePagoModal({
  precioFinal,
  cuotas,
  conCarrito = null,
  logos = [],
  preciosMedios,
  mediosOffline,
  className = "",
}: {
  /** Precio contado del producto (1 pago), con IVA. */
  precioFinal: number;
  cuotas: CuotasProducto;
  /** Nivel que sube el carrito (ver `cuotasFichaConCarrito`): se muestra como fila propia. */
  conCarrito?: CuotasFichaCarrito | null;
  /** Logos de las tarjetas aceptadas (Mercado Pago): abajo, todos juntos. Vacío = no se muestran. */
  logos?: PaymentLogo[];
  /** Precios por medio/forma de la ficha: con débito distinto al crédito el modal se divide en dos bloques. */
  preciosMedios?: PrecioMedio[];
  /** Medios sin cobro en línea con su precio: un bloque por cada uno, debajo de las tarjetas. */
  mediosOffline?: PrecioOffline[];
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  // El Dialog es controlado y sin `Trigger`, así que Radix no sabe a quién
  // devolverle el foco al cerrar: lo hacemos a mano.
  const botonRef = useRef<HTMLButtonElement>(null);
  const cambiarAbierto = (abrir: boolean) => {
    setAbierto(abrir);
    if (!abrir) requestAnimationFrame(() => botonRef.current?.focus());
  };

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        className={`text-sm font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${className}`}
      >
        {TEXTOS_CUOTAS.verMediosDePago}
      </button>
      <Dialog
        open={abierto}
        onOpenChange={cambiarAbierto}
        title={TEXTOS_CUOTAS.tituloModal}
        description={TEXTOS_CUOTAS.descripcionModal(precioFinal)}
        size="md"
      >
        {abierto && (
          <MediosDePagoDetalle
            opciones={opcionesCombinadas(cuotas)}
            noAlcanzadas={filasNoAlcanzadas(cuotas)}
            conCarrito={conCarrito}
            precioContado={precioFinal}
            preciosForma={preciosFormaDelModal(preciosMedios, precioFinal)}
            mediosOffline={mediosOffline}
          />
        )}
        {abierto && logos.length > 0 && (
          <div className="mt-5 flex justify-center border-t border-border pt-4">
            <PaymentLogos aria-label="Tarjetas aceptadas" logos={logos} />
          </div>
        )}
      </Dialog>
    </>
  );
}
