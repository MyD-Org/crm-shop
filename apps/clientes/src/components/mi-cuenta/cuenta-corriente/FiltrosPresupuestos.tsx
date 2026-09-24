"use client";

import { DateRangeField, Select } from "@myd-org/ui";
import type { RangoEmision } from "@/lib/cuenta-corriente/vista-facturas";
import {
  OPCIONES_PRESUPUESTO,
  esFiltroPresupuestos,
  type FiltroPresupuestos,
} from "@/lib/cuenta-corriente/vista-presupuestos";

/**
 * Estado (Todos / Aceptados / Sin aceptar: lo único que Alegra sabe filtrar;
 * vigente y vencido son los dos "sin aceptar" y se distinguen en el estado de
 * cada fila) y rango de fechas de EMISIÓN. Los resuelve Alegra (PRE-1).
 */
export function FiltrosPresupuestos({
  filtro,
  rango,
  onFiltro,
  onRango,
}: {
  filtro: FiltroPresupuestos;
  rango: RangoEmision;
  onFiltro: (filtro: FiltroPresupuestos) => void;
  onRango: (rango: RangoEmision) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="sm:w-48">
        <Select
          aria-label="Estado de los presupuestos"
          options={OPCIONES_PRESUPUESTO.map((o) => ({ value: o.value, label: o.label }))}
          value={filtro}
          onValueChange={(v) => {
            if (esFiltroPresupuestos(v)) onFiltro(v);
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
