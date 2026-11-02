import type { CuponAplicado } from "@/lib/cupones/tipos";
import { fmtPrecio } from "@/lib/format";
import { textoLineaCupon } from "@/lib/cupones/ui";

/**
 * La línea del cupón en el resumen del carrito y del checkout (entre Impuestos y Total): una sola
 * línea con el descuento (las líneas no lo muestran repartido), "Envío gratis (cupón)" si corresponde
 * y el aviso del cupón (invitado, todo en campaña, restricción de pago).
 */
export function LineaCupon({ cupon }: { cupon: CuponAplicado }) {
  return (
    <div className="space-y-1">
      {cupon.descuento > 0 && (
        <div className="flex justify-between gap-3 text-sm">
          <dt className="text-success">{textoLineaCupon(cupon)}</dt>
          <dd className="font-medium tabular-nums text-success">−{fmtPrecio(cupon.descuento)}</dd>
        </div>
      )}
      {cupon.envioGratis && (
        <div className="flex justify-between gap-3 text-sm">
          <dt className="text-success">Envío gratis (cupón)</dt>
          <dd className="font-medium text-success">{fmtPrecio(0)}</dd>
        </div>
      )}
      {cupon.aviso && <p className="text-xs text-muted">{cupon.aviso}</p>}
    </div>
  );
}
