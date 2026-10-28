import { cn } from "@myd-org/ui";
import type { Referencia } from "@/data/home-defaults";
import { fmtPrecioCorto } from "@/lib/format";
import { descuentoPropio, enFrase, escaleraPrecios } from "@/lib/promociones/promo";

/*
 * Piezas visuales de la promo, compartidas por la home y la ficha para que digan lo mismo.
 * Lenguaje de color: navy = precio, verde = ahorro, rojo = urgencia (unidades, cuenta regresiva).
 * El % se calcula SOLO contra nuestro precio habitual (es exacto y real). La comparación con otros
 * canales va en la escalera, en pesos y sin porcentaje.
 * Criterio visual: una sola superficie por card; las piezas son texto y trazos finos, sin cajas
 * propias, para que el precio sea lo único que pesa.
 */

/**
 * Antes y ahora: arriba nuestro precio habitual tachado con el descuento propio al lado (texto verde,
 * sin caja), abajo el precio de apertura. Sin habitual (o sin rebaja real), sólo el precio.
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
    <div className="flex flex-col items-start gap-1">
      {d && habitual ? (
        <p className={cn("flex flex-wrap items-baseline gap-x-2", grande ? "text-[15px]" : "text-xs")}>
          <span className="tabular-nums text-muted line-through">
            <span className="sr-only">Antes: </span>
            {fmtPrecioCorto(habitual)}
          </span>
          <span data-descuento="" className="font-bold text-success">
            {d.pct} % de descuento
          </span>
        </p>
      ) : null}
      <p
        className={cn(
          "font-display font-extrabold leading-none tabular-nums text-primary",
          grande ? "text-[clamp(30px,3vw,40px)]" : "text-[clamp(20px,2vw,24px)]",
        )}
      >
        {fmtPrecioCorto(precio)}
      </p>
      {esTransferencia ? <p className={cn("text-muted", grande ? "text-[13px]" : "text-xs")}>por transferencia</p> : null}
    </div>
  );
}

function Fila({ etiqueta, precio, ancho, propia, compacta }: { etiqueta: string; precio: number; ancho: number; propia?: boolean; compacta?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className={cn("flex items-baseline justify-between gap-3", compacta ? "text-[11px]" : "text-xs", propia ? "font-semibold text-success" : "text-muted")}>
        <span className="truncate">{etiqueta}</span>
        <span className="shrink-0 tabular-nums">{fmtPrecioCorto(precio)}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-black/5" aria-hidden>
        <div className={cn("h-full rounded-full", propia ? "bg-success" : "bg-black/20")} style={{ width: `${Math.max(ancho * 100, 4)}%` }} />
      </div>
    </div>
  );
}

/**
 * Escalera de comparación: los precios de otros canales de mayor a menor y al pie el nuestro en verde
 * (la barra más corta). Discreta: barras de 4 px y texto chico, sin fondo. La versión completa
 * (estrella y ficha) admite un título opcional y cierra con el ahorro máximo; compacta (cards) son
 * sólo las barras.
 */
export function EscaleraPrecios({
  precio,
  referencias,
  tienda,
  titulo,
  compacta = false,
  className,
}: {
  precio: number;
  referencias?: Referencia[];
  /** Nombre de la tienda en la última fila ("Central LED"). */
  tienda: string;
  titulo?: string;
  compacta?: boolean;
  className?: string;
}) {
  const e = escaleraPrecios(precio, referencias);
  if (!e) return null;
  return (
    <div data-escalera="" className={cn("flex flex-col gap-2", className)}>
      {titulo && !compacta ? <p className="text-[13px] font-semibold text-text">{titulo}</p> : null}
      {e.filas.map((f) => (
        <Fila key={`${f.etiqueta}-${f.precio}`} etiqueta={f.etiqueta} precio={f.precio} ancho={f.ancho} compacta={compacta} />
      ))}
      <Fila etiqueta={tienda} precio={precio} ancho={e.ancho} propia compacta={compacta} />
      {!compacta ? <p className="text-xs font-semibold text-success">Ahorra hasta {fmtPrecioCorto(e.ahorroMax)}</p> : null}
    </div>
  );
}

/** Hasta cuántas unidades se dibujan puntos; más que eso, sólo el texto. */
const MAX_PUNTOS = 12;

/**
 * Unidades a precio de apertura en una línea: un punto por unidad (rojos los disponibles, grises los
 * vendidos) y "¡Últimas N unidades a <etiqueta>!". Siempre en clave de escasez, sin el total.
 */
export function UnidadesPromo({ quedan, total, etiqueta }: { quedan: number; total: number; /** "Precio de apertura": va en la frase. */ etiqueta: string }) {
  return (
    <div data-sello="unidades" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {total <= MAX_PUNTOS ? (
        <span className="flex gap-1" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              data-unidad={i < quedan ? "libre" : "vendida"}
              className={cn("h-2 w-2 rounded-full", i < quedan ? "bg-danger" : "bg-black/15")}
            />
          ))}
        </span>
      ) : null}
      <p className="text-sm text-text">
        <strong className="text-danger">{quedan === 1 ? "¡Última unidad" : `¡Últimas ${quedan} unidades`}</strong> a {enFrase(etiqueta)}!
      </p>
    </div>
  );
}
