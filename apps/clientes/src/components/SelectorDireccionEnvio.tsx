"use client";

import { Field, Select } from "@myd-org/ui";
import {
  OTRA_DIRECCION,
  lineasDireccion,
  opcionDireccion,
  type DireccionEnvio,
} from "@/lib/direcciones-envio";

/**
 * Elegir una dirección guardada en el checkout (sólo con Clerk y al menos una
 * guardada). Arranca en la predeterminada. "Otra dirección para esta compra"
 * devuelve los campos de siempre del checkout y no toca las guardadas.
 *
 * Toda guardada sirve para envío a domicilio: si es gratis o a coordinar lo
 * muestra el checkout con la regla vigente (`evaluarEnvio`), no este selector.
 */
export function SelectorDireccionEnvio({
  direcciones,
  valor,
  onCambiar,
}: {
  direcciones: DireccionEnvio[];
  valor: string;
  onCambiar: (valor: string) => void;
}) {
  const elegida = direcciones.find((d) => d.id === valor);
  const opciones = [
    ...direcciones.map((d) => ({
      label: d.predeterminada ? `${opcionDireccion(d)} (predeterminada)` : opcionDireccion(d),
      value: d.id,
    })),
    { label: "Otra dirección para esta compra", value: OTRA_DIRECCION },
  ];

  return (
    <div className="mt-4 flex flex-col gap-3">
      <Field label="Dirección de entrega">
        <Select options={opciones} value={valor} onValueChange={onCambiar} />
      </Field>
      {elegida && (
        <address className="text-sm not-italic text-muted">
          {lineasDireccion(elegida).map((l) => (
            <span key={l} className="block">
              {l}
            </span>
          ))}
        </address>
      )}
    </div>
  );
}
