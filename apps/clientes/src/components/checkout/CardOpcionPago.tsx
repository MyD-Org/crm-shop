import { PaymentLogos, type PaymentLogo } from "@myd-org/ui";
import { ChipsMedioPago } from "@/components/checkout/ChipsMedioPago";
import { IconoBanco, IconoBilletera, IconoTarjeta, IconoTarjetaDebito } from "@/components/PagoIconos";
import { SLUG_TRANSFERENCIA } from "@/lib/cuentas-bancarias";
import { fmtPrecio } from "@/lib/format";
import type { MedioPago } from "@/lib/medios-pago";
import type { OpcionPago } from "@/lib/opciones-pago";

function Icono({ opcion }: { opcion: OpcionPago }) {
  if (opcion.forma === "credito") return <IconoTarjeta />;
  if (opcion.forma === "debito") return <IconoTarjetaDebito />;
  if (opcion.slug === SLUG_TRANSFERENCIA) return <IconoBanco />;
  return <IconoBilletera />;
}

function IconoAhorro() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 12v10H4V12" />
      <path d="M22 7H2v5h20V7z" />
      <path d="M12 22V7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  );
}

/** Lo que pasa al confirmar con la card elegida (los medios manuales muestran sus instrucciones). */
function detalleDe(opcion: OpcionPago, medio: MedioPago): string {
  if (opcion.forma === "cuenta_mp") return "Al confirmar, lo llevamos directo a Mercado Pago para que pague desde su cuenta.";
  if (opcion.forma === "credito") return "Al confirmar, ingresa los datos de la tarjeta y elige las cuotas.";
  if (opcion.forma === "debito") return "Al confirmar, ingresa los datos de la tarjeta de débito.";
  return medio.instrucciones.trim();
}

/**
 * Card del paso Pago: una forma de pagar con el total que se paga con ella. La de transferencia
 * resalta cuánto se ahorra frente a la opción más cara. La elegida se abre con lo que pasa al confirmar.
 */
export function CardOpcionPago({
  opcion,
  medio,
  titulo,
  bajada,
  selected,
  onClick,
  total,
  ahorro,
  ahorroFrenteA,
  logos,
}: {
  opcion: OpcionPago;
  medio: MedioPago;
  titulo: string;
  bajada?: string;
  selected: boolean;
  onClick: () => void;
  /** Total con esta card; `undefined` = todavía no llegó, `null` = no se pudo calcular. */
  total: number | null | undefined;
  ahorro: { monto: number; frente: OpcionPago } | null;
  ahorroFrenteA: (o: OpcionPago) => string;
  logos?: PaymentLogo[];
}) {
  const detalle = detalleDe(opcion, medio);
  // Las etiquetas del admin ("Hasta 6 cuotas sin interés") son del medio: en Mercado Pago van con el crédito.
  const conChips = opcion.forma === null || opcion.forma === "credito";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full cursor-pointer flex-col rounded-[20px] bg-surface text-left transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
        selected ? "border-[1.5px] border-accent shadow-2" : "border border-border hover:border-accent"
      }`}
    >
      <span className="flex items-center gap-3 p-4 sm:gap-4 sm:px-5">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            selected ? "border-accent bg-accent" : "border-border-strong"
          }`}
        >
          {selected && <span className="h-2 w-2 rounded-full bg-white" />}
        </span>
        <span
          className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex ${
            selected ? "bg-accent-soft text-accent" : "bg-bg text-muted"
          }`}
        >
          <Icono opcion={opcion} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-extrabold text-text sm:text-base">{titulo}</span>
          {bajada && <span className="text-xs text-muted sm:text-[13px]">{bajada}</span>}
          {logos && logos.length > 0 && <PaymentLogos logos={logos} className="mt-1" />}
          {conChips && <ChipsMedioPago chips={medio.chips} />}
        </span>
        <span className="flex shrink-0 flex-col items-end">
          {total === undefined ? (
            <span className="h-6 w-24 animate-pulse rounded-md bg-bg" aria-label="Calculando el total" />
          ) : total === null ? (
            <span className="text-sm text-muted">—</span>
          ) : (
            <span className="font-display text-lg font-semibold whitespace-nowrap text-text tabular-nums sm:text-[21px]">
              {fmtPrecio(total)}
            </span>
          )}
          {(opcion.forma === "credito" || opcion.forma === "debito") && <span className="text-[11px] text-muted sm:text-xs">en 1 pago</span>}
        </span>
      </span>
      {ahorro && (
        <span className="mx-4 mb-4 flex items-center gap-2 rounded-xl bg-success-soft px-3 py-2 text-[13px] font-bold text-success sm:mr-5 sm:ml-[92px]">
          <IconoAhorro />
          Ahorra {fmtPrecio(ahorro.monto)} frente a {ahorroFrenteA(ahorro.frente).toLowerCase()}
        </span>
      )}
      {selected && detalle && (
        <span className="mx-4 mb-4 border-t border-border pt-3 text-[13px] whitespace-pre-line text-text sm:mr-5 sm:ml-[92px]">
          {detalle}
        </span>
      )}
    </button>
  );
}
