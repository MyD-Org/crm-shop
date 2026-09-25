import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import type { OpcionCuotas } from "@/lib/pagos/cuotas-tipos";

/**
 * Una línea con la mejor opción: "6 cuotas sin interés de $20.000" o
 * "12 cuotas de $13.500". Sin opción → nada.
 *
 * `tono="oscuro"` queda para cards de fondo oscuro (la ficha usa "claro"
 * desde el reskin editorial).
 * `tamano`: "sm" dentro de la card del catálogo (debajo del precio, secundaria),
 * "md" por defecto, "lg" para la ficha de producto.
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
  const color = opcion.sinInteres
    ? tono === "oscuro"
      ? "text-success-sobre-oscuro"
      : "text-success"
    : tono === "oscuro"
      ? "text-white"
      : "text-text";
  return (
    <span className={`${TAMANOS[tamano]} ${color} ${className}`}>
      {TEXTOS_CUOTAS.linea(opcion.cuotas, opcion.montoCuota, opcion.sinInteres)}
    </span>
  );
}
