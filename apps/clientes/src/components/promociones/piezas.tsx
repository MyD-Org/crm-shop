import { cn } from "@myd-org/ui";
import { fmtPrecioCorto } from "@/lib/format";
import { esUltimas } from "@/lib/promociones/promo";

/*
 * Piezas visuales de la promo, compartidas por la home y la ficha para que digan lo mismo. Regla de
 * copy: el descuento SIEMPRE dice contra qué es ("más barato que en otras tiendas"); un "−19 %" solo
 * se lee como rebaja de nuestro propio precio. Sin verbos en segunda persona ("ahorre"/"ahorrás"): el
 * sitio habla de usted y el ahorro se dice como dato ("$X menos que en otras tiendas").
 */

/** Etiqueta roja rectangular: "19 % más barato" / "que en otras tiendas". */
export function EtiquetaMasBarato({ pct, grande = false, className }: { pct: number; grande?: boolean; className?: string }) {
  return (
    <span
      data-sello="descuento"
      className={cn("inline-flex flex-col rounded-lg bg-danger text-white shadow-md", grande ? "px-3.5 py-2" : "px-2.5 py-1.5", className)}
    >
      <span className={cn("font-display font-extrabold leading-none tabular-nums", grande ? "text-[22px] md:text-[26px]" : "text-[15px]")}>
        {pct} % más barato
      </span>
      <span className={cn("leading-tight text-white/90", grande ? "mt-1 text-xs" : "mt-0.5 text-[10px]")}>que en otras tiendas</span>
    </span>
  );
}

/** "$X menos que en otras tiendas": franja sobre el pie de la foto (o línea, en la ficha). */
export function AhorroPesos({
  pesos,
  referencia,
  etiqueta,
  pct,
  enFoto = false,
}: {
  pesos: number;
  referencia: number;
  etiqueta: string;
  /** En la foto de una oferta, el % va en la misma franja (una sola pieza, no dos que repiten). */
  pct?: number | null;
  enFoto?: boolean;
}) {
  if (enFoto) {
    return (
      <div data-ahorro="" className="rounded-xl bg-white/95 px-3 py-2 shadow-md ring-1 ring-black/5 backdrop-blur">
        <p className="text-[13px] font-extrabold leading-tight text-danger">{fmtPrecioCorto(pesos)} menos que en otras tiendas</p>
        <p className="mt-0.5 text-[11px] leading-tight text-muted">
          {pct ? <span className="font-semibold text-text">{pct} % más barato · </span> : null}
          {etiqueta} {fmtPrecioCorto(referencia)}
        </p>
      </div>
    );
  }
  return (
    <div data-ahorro="" className="flex flex-col gap-0.5">
      <p className="text-[15px] font-bold text-danger">{fmtPrecioCorto(pesos)} menos que en otras tiendas</p>
      <p className="text-xs text-muted">
        {etiqueta} {fmtPrecioCorto(referencia)}
      </p>
    </div>
  );
}

/** Hasta cuántas unidades se dibujan casilleros; más que eso, una barra. */
const MAX_CASILLEROS = 12;

/**
 * Unidades a precio de apertura: un casillero por unidad (rojos los disponibles, grises los vendidos)
 * y el texto. Con 2 o menos, "¡Últimas N unidades!" como titular.
 */
export function UnidadesPromo({ quedan, total }: { quedan: number; total: number }) {
  const ultimas = esUltimas(quedan);
  return (
    <div data-sello="unidades" className="flex flex-col gap-2 rounded-xl bg-elevated px-4 py-3">
      {ultimas ? (
        <p className="text-sm font-extrabold text-danger">{quedan === 1 ? "¡Última unidad!" : `¡Últimas ${quedan} unidades!`}</p>
      ) : null}
      {total <= MAX_CASILLEROS ? (
        <div className="flex gap-1.5" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              data-unidad={i < quedan ? "libre" : "vendida"}
              className={cn("h-3 flex-1 rounded-sm", i < quedan ? "bg-danger" : "bg-black/10")}
            />
          ))}
        </div>
      ) : (
        <div className="h-3 overflow-hidden rounded-sm bg-black/10" aria-hidden>
          <div className="h-full bg-danger" style={{ width: `${(quedan / total) * 100}%` }} />
        </div>
      )}
      <p className="text-sm text-text">
        Quedan <strong>{quedan} de {total} unidades</strong> a precio de apertura
      </p>
      <p className="text-xs text-muted">Después vuelve a su precio normal.</p>
    </div>
  );
}
