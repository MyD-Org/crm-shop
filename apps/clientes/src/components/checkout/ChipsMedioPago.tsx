import { Badge } from "@myd-org/ui";
import { tonoBadgeDeChip, type ChipMedio } from "@/lib/medios-pago-chips";

/**
 * Etiquetas que el admin carga en un medio de pago ("Hasta 8 cuotas sin interés", "Recomendado"…),
 * resaltadas sobre la opción de ese medio en el checkout. Van en el orden cargado; sin etiquetas no
 * dibuja nada. Es texto plano (React lo escapa): el CRM además rechaza HTML al guardarlas.
 */
export function ChipsMedioPago({ chips }: { chips?: readonly ChipMedio[] }) {
  if (!chips || chips.length === 0) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5" data-chips-medio>
      {chips.map((c, i) => (
        <Badge key={`${i}-${c.texto}`} tone={tonoBadgeDeChip(c.tono)}>
          {c.texto}
        </Badge>
      ))}
    </span>
  );
}
