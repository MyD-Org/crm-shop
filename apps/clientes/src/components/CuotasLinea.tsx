import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import type { OpcionCuotas } from "@/lib/cuotas-sin-interes";

/**
 * Una línea con la mejor opción: "6 cuotas sin interés de $20.000". Sin opción → nada.
 *
 * `tono="oscuro"` queda para cards de fondo oscuro (la ficha usa "claro" desde el reskin editorial).
 * `tamano`: "sm" dentro de la card del catálogo (debajo del precio, secundaria), "md" por defecto,
 * "lg" para la ficha de producto.
 */
const TAMANOS = {
  sm: "text-xs font-medium",
  md: "text-sm font-semibold",
  lg: "text-base font-semibold",
} as const;

export function CuotasLinea({
  opcion,
  tono = "claro",
  tamano = "md",
  className = "",
}: {
  opcion: OpcionCuotas | null;
  tono?: "claro" | "oscuro";
  tamano?: keyof typeof TAMANOS;
  className?: string;
}) {
  if (!opcion) return null;
  const color = tono === "oscuro" ? "text-success-sobre-oscuro" : "text-success";
  return (
    <span className={`${TAMANOS[tamano]} ${color} ${className}`}>
      {TEXTOS_CUOTAS.linea(opcion.cuotas, opcion.montoCuota)}
    </span>
  );
}
