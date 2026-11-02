import type { CuponAplicado } from "@/lib/cupones/tipos";
import { fmtPrecio } from "@/lib/format";
import { textoLineaCupon } from "@/lib/cupones/ui";

/** El cupón se ve como línea propia del resumen (descuento o envío gratis). Sin línea, `CampoCupon` muestra el código. */
export function cuponTieneLinea(cupon: CuponAplicado): boolean {
  return cupon.descuento > 0 || cupon.envioGratis;
}

function QuitarIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** X para quitar el cupón, al lado del texto de su línea. */
export function BotonQuitarCupon({ codigo, onQuitar }: { codigo: string; onQuitar: () => void }) {
  return (
    <button
      type="button"
      onClick={onQuitar}
      aria-label={`Quitar el cupón ${codigo}`}
      title="Quitar cupón"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted hover:bg-elevated hover:text-text"
    >
      <QuitarIcon />
    </button>
  );
}

/**
 * La línea del cupón en el resumen del carrito y del checkout (entre Impuestos y Total): una sola
 * línea con el descuento (las líneas no lo muestran repartido), "Envío gratis (cupón)" si corresponde
 * y el aviso del cupón (invitado, todo en campaña, restricción de pago). Con `onQuitar`, la primera
 * línea lleva una X para quitar el cupón.
 */
export function LineaCupon({ cupon, onQuitar }: { cupon: CuponAplicado; onQuitar?: () => void }) {
  const xEnDescuento = !!onQuitar && cupon.descuento > 0;
  const xEnEnvio = !!onQuitar && !xEnDescuento && cupon.envioGratis;
  return (
    <div className="space-y-1">
      {cupon.descuento > 0 && (
        <div className="flex justify-between gap-3 text-sm">
          <dt className="flex items-center gap-1 text-success">
            {textoLineaCupon(cupon)}
            {xEnDescuento && <BotonQuitarCupon codigo={cupon.codigo} onQuitar={onQuitar!} />}
          </dt>
          <dd className="font-medium tabular-nums text-success">−{fmtPrecio(cupon.descuento)}</dd>
        </div>
      )}
      {cupon.envioGratis && (
        <div className="flex justify-between gap-3 text-sm">
          <dt className="flex items-center gap-1 text-success">
            Envío gratis (cupón)
            {xEnEnvio && <BotonQuitarCupon codigo={cupon.codigo} onQuitar={onQuitar!} />}
          </dt>
          <dd className="font-medium text-success">{fmtPrecio(0)}</dd>
        </div>
      )}
      {cupon.aviso && <p className="text-xs text-muted">{cupon.aviso}</p>}
    </div>
  );
}
