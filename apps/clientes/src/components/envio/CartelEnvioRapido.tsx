import { Badge } from "@myd-org/ui";

/**
 * Cartel verde del envío por zona (change `envio-rapido`, flag `envio-por-zona`). Lleva el NOMBRE del método
 * tal como lo cargó el comercio en el CRM (no un texto fijo), con un rayo. Badge de éxito del DS: sin estilos
 * propios encima.
 */
export function CartelEnvioRapido({ nombre }: { nombre: string }) {
  const texto = nombre.trim();
  if (!texto) return null;
  return (
    <Badge tone="success" data-envio-zona="cartel">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="mr-1 inline-block align-[-1px]">
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
      </svg>
      {texto}
    </Badge>
  );
}
