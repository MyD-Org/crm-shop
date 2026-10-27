import { cn } from "@myd-org/ui";
import type { Referencia } from "@/data/home-defaults";
import { fmtPrecioCorto } from "@/lib/format";
import { descuentoPropio, escaleraPrecios, esUltimas, fechaRelevamientoAR } from "@/lib/promociones/promo";

/*
 * Piezas visuales de la promo, compartidas por la home y la ficha para que digan lo mismo.
 * Lenguaje de color: navy = precio, verde = ahorro, rojo = urgencia (unidades, cuenta regresiva).
 * El % se calcula SOLO contra nuestro precio habitual (es exacto y real). La comparación con otros
 * canales va en la escalera, en pesos y sin porcentaje.
 */

/**
 * Antes y ahora: nuestro precio habitual tachado, el precio de apertura y la pastilla verde del
 * descuento propio. Sin habitual (o sin rebaja real), sólo el precio.
 */
export function PrecioPromo({
  precio,
  habitual,
  esTransferencia,
  tamano = "grande",
}: {
  precio: number;
  habitual?: number;
  esTransferencia: boolean;
  tamano?: "grande" | "chico";
}) {
  const d = descuentoPropio(precio, habitual);
  const grande = tamano === "grande";
  return (
    <div className="flex flex-col items-start">
      {d && habitual ? (
        <p className={cn("tabular-nums text-muted line-through", grande ? "text-base" : "text-xs")}>
          <span className="sr-only">Antes: </span>
          {fmtPrecioCorto(habitual)}
        </p>
      ) : null}
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={cn(
            "font-display font-extrabold leading-none tabular-nums text-primary",
            grande ? "text-[clamp(32px,3.6vw,46px)]" : "text-[clamp(20px,2vw,26px)]",
          )}
        >
          {fmtPrecioCorto(precio)}
        </span>
        {esTransferencia ? <span className={cn("text-muted", grande ? "text-sm" : "text-xs")}>por transferencia</span> : null}
      </p>
      {d ? (
        <span
          data-descuento=""
          className={cn("mt-2 rounded-md bg-success-soft font-bold text-success", grande ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs")}
        >
          {d.pct} % de descuento
        </span>
      ) : null}
    </div>
  );
}

function Fila({ etiqueta, precio, ancho, propia, compacta }: { etiqueta: string; precio: number; ancho: number; propia?: boolean; compacta?: boolean }) {
  return (
    <div>
      <div className={cn("flex items-baseline justify-between gap-3", compacta ? "text-[11px]" : "text-[13px]", propia ? "font-bold text-success" : "text-muted")}>
        <span className="truncate">{etiqueta}</span>
        <span className="shrink-0 tabular-nums">{fmtPrecioCorto(precio)}</span>
      </div>
      <div className={cn("mt-1 overflow-hidden rounded-full", compacta ? "h-1.5" : "h-2.5")} aria-hidden>
        <div className={cn("h-full rounded-full", propia ? "bg-success" : "bg-black/15")} style={{ width: `${Math.max(ancho * 100, 4)}%` }} />
      </div>
    </div>
  );
}

/**
 * Escalera de comparación: los precios de otros canales de mayor a menor, en barras grises, y al pie
 * el nuestro en verde (la barra más corta). Con título (estrella y ficha) cierra con el ahorro máximo
 * y la fecha del relevamiento; compacta (cards de ofertas) son sólo las barras.
 */
export function EscaleraPrecios({
  precio,
  referencias,
  tienda,
  titulo,
  fecha,
  compacta = false,
  className,
}: {
  precio: number;
  referencias?: Referencia[];
  /** Nombre de la tienda en la última fila ("Central Led"). */
  tienda: string;
  titulo?: string;
  /** Día del relevamiento (YYYY-MM-DD). */
  fecha?: string;
  compacta?: boolean;
  className?: string;
}) {
  const e = escaleraPrecios(precio, referencias);
  if (!e) return null;
  return (
    <div data-escalera="" className={cn("flex flex-col", compacta ? "gap-1.5" : "gap-2.5 rounded-xl bg-elevated px-4 py-3.5", className)}>
      {titulo && !compacta ? <p className="font-display text-[15px] font-bold leading-snug text-text">{titulo}</p> : null}
      {e.filas.map((f) => (
        <Fila key={`${f.etiqueta}-${f.precio}`} etiqueta={f.etiqueta} precio={f.precio} ancho={f.ancho} compacta={compacta} />
      ))}
      <Fila etiqueta={tienda} precio={precio} ancho={e.ancho} propia compacta={compacta} />
      {!compacta ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2 pt-0.5">
          <p className="text-sm font-bold text-success">Ahorra hasta {fmtPrecioCorto(e.ahorroMax)}</p>
          {fecha ? <p className="text-[11px] text-muted">Precios relevados el {fechaRelevamientoAR(fecha)}</p> : null}
        </div>
      ) : null}
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
