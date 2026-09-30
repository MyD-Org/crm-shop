import {
  lineasDisponibilidad,
  type DisponibilidadVista,
  type LocalDisponibilidad,
  type TonoDisponibilidad,
} from "@/lib/disponibilidad-textos";

const CLASE_TONO: Record<TonoDisponibilidad, string> = {
  ok: "text-success",
  demora: "text-warning",
  no: "text-danger",
};

/**
 * Disponibilidad de un producto por local y de envío: "Retiro en <local>: disponible hoy |
 * disponible en N días | no disponible" y "Envío a domicilio: ...". Sólo se dibuja con el flag
 * `disponibilidad-sucursal` (el server no manda `disponibilidad` si está apagado). El envío sólo
 * se anuncia con el flag `envio`.
 */
export function DisponibilidadLineas({
  disponibilidad,
  locales,
  envio,
  className = "",
}: {
  disponibilidad: DisponibilidadVista;
  locales: LocalDisponibilidad[];
  envio: boolean;
  className?: string;
}) {
  const lineas = lineasDisponibilidad(disponibilidad, locales, {
    conEnvio: envio,
  });
  if (lineas.length === 0) return null;
  return (
    <ul
      aria-label="Disponibilidad"
      className={`space-y-1 text-[13px] font-semibold ${className}`}
    >
      {lineas.map((l) => (
        <li key={l.texto} className="flex items-start gap-2">
          <span
            aria-hidden
            className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current ${CLASE_TONO[l.tono]}`}
          />
          <span className={CLASE_TONO[l.tono]}>{l.texto}</span>
        </li>
      ))}
    </ul>
  );
}
