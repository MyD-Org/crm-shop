import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import type { OpcionCuotas } from "@/lib/pagos/cuotas-tipos";

/**
 * Una línea con la mejor opción: "6 cuotas sin interés de $20.000" o
 * "12 cuotas de $13.500". Sin opción → nada.
 *
 * `tono="oscuro"` para la card de precio de la ficha (fondo azul).
 */
export function CuotasLinea({
  opcion,
  tono = "claro",
  grande = false,
  className = "",
}: {
  opcion: OpcionCuotas | null;
  tono?: "claro" | "oscuro";
  grande?: boolean;
  className?: string;
}) {
  if (!opcion) return null;
  const color = opcion.sinInteres
    ? tono === "oscuro"
      ? "text-[#7ee2a8]"
      : "text-success"
    : tono === "oscuro"
      ? "text-white"
      : "text-text";
  return (
    <p className={`${grande ? "text-base" : "text-sm"} font-semibold ${color} ${className}`}>
      {TEXTOS_CUOTAS.linea(opcion.cuotas, opcion.montoCuota, opcion.sinInteres)}
    </p>
  );
}
