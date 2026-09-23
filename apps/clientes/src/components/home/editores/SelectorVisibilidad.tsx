"use client";

import { Select } from "@myd-org/ui";
import type { SoloEn, Visibilidad } from "@/data/home-defaults";

export const OPCIONES_VISIBILIDAD: { value: Visibilidad; label: string }[] = [
  { value: "siempre", label: "Siempre" },
  { value: "desktop", label: "Solo desktop" },
  { value: "mobile", label: "Solo mobile" },
  { value: "nunca", label: "Nunca" },
];

/**
 * "Mostrar: Siempre / Solo desktop / Solo mobile / Nunca" de un texto o de un
 * ítem de lista. "Siempre" se guarda como ausente.
 */
export function SelectorVisibilidad({
  valor,
  onChange,
  ariaLabel,
}: {
  valor: SoloEn | undefined;
  onChange: (v: SoloEn | undefined) => void;
  /** Distinto por campo: en un mismo Dialog hay varios selectores. */
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted">Mostrar</span>
      <div className="w-36">
        <Select
          aria-label={ariaLabel}
          options={OPCIONES_VISIBILIDAD}
          value={valor ?? "siempre"}
          onValueChange={(v) => onChange(v === "siempre" ? undefined : (v as SoloEn))}
        />
      </div>
    </div>
  );
}
