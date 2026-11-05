"use client";

import { Field, Input } from "@myd-org/ui";
import type { PromosPagoContent } from "@/data/home-defaults";
import type { EditorProps } from "./index";

type CampoTexto = "titulo" | "cuotasTexto" | "descuentoTitulo" | "descuentoTexto";

/**
 * Promos de pago: cada etiqueta se muestra sólo si la promoción existe (cuotas sin interés de los medios
 * de cobro, descuento del medio destacado). Acá se editan el título y los textos; vacío = texto por
 * defecto. El número de cuotas no se edita: es el real.
 */
export function EditorPromosPago({ valor, onChange }: EditorProps<PromosPagoContent>) {
  // Vacío se guarda como ausente: la validación no acepta textos vacíos y así vuelve el de por defecto.
  const set = (campo: CampoTexto) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    const siguiente = { ...valor, [campo]: v };
    if (!v.trim()) delete siguiente[campo];
    onChange(siguiente);
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Cada etiqueta aparece sólo si la promoción está vigente: las cuotas sin interés de los medios de cobro y el
        descuento del medio destacado del catálogo. Si no hay ninguna, la sección no se muestra.
      </p>
      <Field label="Título de la sección" hint="Opcional. Por ejemplo: Beneficios para pagar">
        <Input value={valor.titulo ?? ""} onChange={set("titulo")} />
      </Field>
      <Field
        label="Texto de la etiqueta de cuotas"
        hint="Debajo de «Hasta N cuotas sin interés». Vacío: «Con tarjeta de crédito.» Si hay un mínimo de compra, se agrega solo."
      >
        <Input value={valor.cuotasTexto ?? ""} placeholder="Con tarjeta de crédito." onChange={set("cuotasTexto")} />
      </Field>
      <Field label="Título de la etiqueta de descuento" hint="Vacío: «Grandes descuentos».">
        <Input value={valor.descuentoTitulo ?? ""} placeholder="Grandes descuentos" onChange={set("descuentoTitulo")} />
      </Field>
      <Field label="Texto de la etiqueta de descuento" hint="Vacío: «Pagando con» y el medio destacado.">
        <Input value={valor.descuentoTexto ?? ""} placeholder="Pagando con Transferencia." onChange={set("descuentoTexto")} />
      </Field>
    </div>
  );
}
