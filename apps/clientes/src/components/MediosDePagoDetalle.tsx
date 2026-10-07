import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import type { CuotaNoAlcanzada, OpcionCuotas } from "@/lib/cuotas-sin-interes";
import { fmtPrecio } from "@/lib/format";

/**
 * Contenido del modal "Ver medios de pago": UN bloque "Tarjeta de crédito o débito" con 1 pago
 * (precio contado) y una fila por cada cantidad de cuotas SIN INTERÉS ofrecida por cualquiera de los
 * medios (ya combinadas con `opcionesCombinadas`). No nombra al procesador: eso queda para el checkout.
 *
 * Separado del diálogo para poder testearlo con render estático.
 */
export function MediosDePagoDetalle({
  opciones,
  precioContado,
  noAlcanzadas = [],
  conCarrito = null,
}: {
  opciones: OpcionCuotas[];
  precioContado: number;
  /** Cantidades que el producto no alcanza por mínimo: filas secundarias, sin monto por cuota. */
  noAlcanzadas?: CuotaNoAlcanzada[];
  /**
   * Con el carrito la compra alcanza un nivel que el producto solo no: se muestra como fila de
   * cuotas (con el monto de este producto) y deja de ser una fila atenuada "desde $X".
   */
  conCarrito?: Pick<OpcionCuotas, "cuotas" | "total" | "montoCuota"> | null;
}) {
  // Mínimo de la cantidad que se alcanza con el carrito: la fila lo aclara ("En compras desde $X"),
  // sin mencionar el carrito.
  const minimoConCarrito = conCarrito ? noAlcanzadas.find((n) => n.cuotas === conCarrito.cuotas)?.minimo : undefined;
  const filas: (OpcionCuotas & { minimo?: number })[] = conCarrito
    ? [
        ...opciones.filter((o) => o.cuotas !== conCarrito.cuotas),
        { ...conCarrito, sinInteres: true as const, minimo: minimoConCarrito },
      ].sort((a, b) => a.cuotas - b.cuotas)
    : opciones;
  const atenuadas = conCarrito ? noAlcanzadas.filter((n) => n.cuotas !== conCarrito.cuotas) : noAlcanzadas;
  return (
    <div className="space-y-5">
      <section aria-labelledby="medio-cuotas">
        <h3 id="medio-cuotas" className="mb-2 text-sm font-bold text-text">
          {TEXTOS_CUOTAS.tituloTarjeta}
        </h3>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          <li className="flex items-center justify-between gap-4 px-3 py-2.5">
            <span className="text-sm text-text">
              {TEXTOS_CUOTAS.unPago}
              <span className="block text-xs text-muted">{TEXTOS_CUOTAS.precioContado}</span>
            </span>
            <span className="text-sm font-semibold text-text">{fmtPrecio(precioContado)}</span>
          </li>
          {filas.map((o) => (
            <li key={o.cuotas} className="flex items-start justify-between gap-4 px-3 py-2.5">
              <span className="text-sm text-text">
                {TEXTOS_CUOTAS.filaCuotas(o.cuotas, o.montoCuota)}
                <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                  {TEXTOS_CUOTAS.sinInteres}
                </span>
                {o.minimo !== undefined && (
                  <span className="block text-xs text-muted" data-testid="fila-con-carrito">
                    {TEXTOS_CUOTAS.enComprasDesde(o.minimo)}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right text-xs text-muted">
                {TEXTOS_CUOTAS.total}
                <span className="block text-sm font-semibold text-text">{fmtPrecio(o.total)}</span>
              </span>
            </li>
          ))}
          {atenuadas.map((n) => (
            <li key={`min-${n.cuotas}`} data-no-alcanzada className="px-3 py-2.5 text-xs text-muted">
              {TEXTOS_CUOTAS.filaNoAlcanzada(n.cuotas, n.minimo)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
