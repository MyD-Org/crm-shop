"use client";

import { DateRangeField, Select } from "@myd-org/ui";
import { OPCIONES_ESTADO, esFiltroEstado, type FiltroEstado, type RangoEmision } from "@/lib/cuenta-corriente/vista-facturas";

/**
 * Estado (uno por vez: Alegra acepta un solo `status` por consulta) y rango de
 * fechas de EMISIÓN (el vencimiento no se puede filtrar en Alegra). Sin
 * búsqueda ni orden por columna: los dos mirarían sólo la página cargada.
 */
export function FiltrosFacturas({
  estado,
  rango,
  sinAbiertas,
  onEstado,
  onRango,
}: {
  estado: FiltroEstado;
  rango: RangoEmision;
  /** Sin las abiertas (saldo caído) no se puede resolver Pendientes ni Vencidas. */
  sinAbiertas: boolean;
  onEstado: (estado: FiltroEstado) => void;
  onRango: (rango: RangoEmision) => void;
}) {
  const opciones = OPCIONES_ESTADO.filter((o) => !sinAbiertas || (o.value !== "pendiente" && o.value !== "vencida"));
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="sm:w-48">
        <Select
          aria-label="Estado de las facturas"
          options={opciones.map((o) => ({ value: o.value, label: o.label }))}
          value={estado}
          onValueChange={(v) => {
            if (esFiltroEstado(v)) onEstado(v);
          }}
        />
      </div>
      <DateRangeField
        label="Fecha de emisión"
        value={rango}
        onChange={onRango}
        labels={{ placeholder: "Fecha de emisión" }}
      />
    </div>
  );
}
