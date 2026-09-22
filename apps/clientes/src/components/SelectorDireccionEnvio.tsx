"use client";

import { Alert, Field, Select } from "@myd-org/ui";
import {
  OTRA_DIRECCION,
  avisoFueraDeZona,
  fueraDeZona,
  lineasDireccion,
  opcionDireccion,
  type DireccionEnvio,
} from "@/lib/direcciones-envio";

/**
 * Elegir una dirección guardada en el checkout (sólo con Clerk y al menos una
 * guardada). Arranca en la predeterminada. "Otra dirección para esta compra"
 * devuelve los campos de siempre del checkout y no toca las guardadas.
 *
 * Una guardada fuera de la zona de envío se lista igual, con el aviso de que se
 * coordina por separado: el checkout no la acepta para envío mientras la zona
 * (`src/lib/envio.ts`) siga limitada, y cuando se abra funciona sola.
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
      {elegida && fueraDeZona(elegida) && (
        <Alert tone="warning">
          {avisoFueraDeZona(elegida.ciudad)} Elija el retiro o coordinaremos la entrega con usted.
        </Alert>
      )}
    </div>
  );
}
