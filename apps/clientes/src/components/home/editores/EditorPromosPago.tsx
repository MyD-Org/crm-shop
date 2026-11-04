"use client";

import { Field, Input } from "@myd-org/ui";
import type { PromosPagoContent } from "@/data/home-defaults";
import type { EditorProps } from "./index";

/**
 * Promos de pago: los avisos salen solos de los medios de pago (cuotas sin interés de cada medio y
 * descuento del medio destacado). Acá sólo se edita el título; dónde se muestra va en el Dialog.
 */
export function EditorPromosPago({ valor, onChange }: EditorProps<PromosPagoContent>) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Los avisos se arman con los medios de pago: las cuotas sin interés configuradas (las de Mercado Pago, desde su
        cuenta) y el descuento del medio destacado en el catálogo. Si no hay ninguna promoción vigente, la sección no se
        muestra.
      </p>
      <Field label="Título" hint="Opcional. Por ejemplo: Beneficios para pagar">
        <Input value={valor.titulo ?? ""} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
      </Field>
    </div>
  );
}
