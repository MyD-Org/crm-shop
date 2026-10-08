"use client";

import { Alert, Field, Select } from "@myd-org/ui";
import type { CuotasRestringidas, OpcionCuotasPedido } from "@/lib/cuotas-pedido";
import { avisoConInteres, filasSelectorCuotas, textoRestringidas, tituloCuotas } from "@/lib/cuotas-formulario";

/**
 * Desplegable "Cuotas" dentro del formulario de pago: todas las cantidades en orden ("1 pago de $X",
 * "N cuotas de $X"), con el chip "Sin interés" en las de la tienda. Se recarga al cargar la tarjeta
 * ("Cuotas con su Visa"). Debajo, sólo con una cuota con interés, el CFT/TEA y quién la financia; y,
 * con la tarjeta cargada, qué cuotas sin interés son de otras tarjetas y, si la elegida no está con esa
 * tarjeta, el aviso de que quedó 1 pago (`noDisponible`, ver `avisoCuotasNoDisponibles`).
 */
export function SelectorCuotas({
  opciones,
  elegida,
  onElegir,
  marca,
  restringidas,
  procesador,
  noDisponible,
  deshabilitado,
}: {
  opciones: readonly OpcionCuotasPedido[];
  elegida: OpcionCuotasPedido | undefined;
  onElegir: (clave: string) => void;
  /** Marca de la tarjeta cargada (null = sin tarjeta). */
  marca: { id: string | null; nombre?: string } | null;
  restringidas: readonly CuotasRestringidas[];
  /** Nombre del procesador del medio en uso ("Mercado Pago", "Payway"). */
  procesador: string;
  /** La cantidad elegida no está con la tarjeta cargada: quedó 1 pago. */
  noDisponible?: string | null;
  deshabilitado?: boolean;
}) {
  const titulo = tituloCuotas(marca);
  const aviso = elegida ? avisoConInteres(elegida, procesador) : null;
  const otrasTarjetas = marca ? textoRestringidas(restringidas) : [];
  return (
    <div className="flex flex-col gap-2" data-selector-cuotas>
      <Field label={titulo} hint={aviso ?? undefined}>
        <Select
          aria-label={titulo}
          value={elegida?.clave}
          disabled={deshabilitado || opciones.length < 2}
          onValueChange={onElegir}
          options={filasSelectorCuotas(opciones)}
        />
      </Field>
      {noDisponible && <Alert tone="warning">{noDisponible}</Alert>}
      {otrasTarjetas.map((t) => (
        <p key={t} className="text-xs text-muted">
          {t}
        </p>
      ))}
    </div>
  );
}
