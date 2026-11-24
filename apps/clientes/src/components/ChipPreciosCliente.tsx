import { Badge } from "@myd-org/ui";
import { TEXTOS_PRECIOS_CLIENTE } from "@/lib/precios-cliente-textos";

/**
 * Chip "Precios de cliente" del header: quien tiene lista online privada ve sus precios en toda la
 * tienda. Reemplaza al banner de ancho completo (la ficha y las cards ya lo dicen junto al precio).
 * Sólo se dibuja si el servidor lo decidió (HeaderServer); no lleva datos de la cuenta.
 */
export function ChipPreciosCliente() {
  return (
    <Badge tone="success" title={TEXTOS_PRECIOS_CLIENTE.aviso} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
        <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
      </svg>
      <span aria-hidden="true">{TEXTOS_PRECIOS_CLIENTE.chip}</span>
      <span className="sr-only">{TEXTOS_PRECIOS_CLIENTE.aviso}</span>
    </Badge>
  );
}
