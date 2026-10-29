/**
 * Precio vigente con campañas de precios (spec apps/admin/docs/superpowers/specs/
 * 2026-10-28-campanias-precios-design.md). ÚNICA regla compartida por exhibición (catálogo, ficha,
 * carrito) y cobro (`cotizarItem`): si dos lugares resolvieran distinto, lo cobrado no coincidiría
 * con lo exhibido.
 *
 * El CRM materializa por producto el precio NETO de campaña de cada lista pública
 * (`campanias_online`); qué campaña está activa lo decide quien llama (`ContextoCampania.activas`,
 * calculado por request fuera de cualquier `use cache`, ver `vigentes.ts`). Puro: sin reloj ni base.
 */
import type { AlegraPrice } from "../alegra";

export interface EntradaCampania {
  id: string;
  reglaId: string;
  inicio: string;
  fin: string;
  pct: number;
  /** Límite de unidades de la regla; null = sin límite. */
  unidades: number | null;
  /** Neto de campaña por lista pública. */
  precios: { idPriceList: string; price: number }[];
}

export interface ContextoCampania {
  /** Ids de las campañas activas en el instante que se cotiza. */
  activas: ReadonlySet<string>;
  /** Unidades que quedan por regla (`reglaId`). Ausente = sin límite. */
  quedan?: ReadonlyMap<string, number>;
}

export interface PrecioResuelto {
  /** Neto que se cobra. */
  precio: number;
  /** Neto normal de referencia, el que se tacha: el de la misma lista, o el privado. */
  normal: number;
  /** La campaña que rige; null = no rige ninguna. */
  campania: EntradaCampania | null;
  /** % que se exhibe; null sin campaña. */
  pct: number | null;
}

/**
 * La lista que rige el precio normal, con la misma regla que `precioDeLista`: la del medio sólo si
 * existe, es mayor que 0 y es menor que la general; si no, la general (`main`, o la primera).
 */
function listaQueRige(prices: AlegraPrice[], idListaMedio?: string): AlegraPrice | undefined {
  const general = prices.find((p) => p.main) ?? prices[0];
  if (idListaMedio) {
    const propia = prices.find((p) => p.idPriceList === idListaMedio);
    if (propia && propia.price > 0 && general && propia.price < general.price) return propia;
  }
  return general;
}

function entradaQueRige(entradas: readonly EntradaCampania[] | undefined, ctx: ContextoCampania | undefined) {
  if (!entradas?.length || !ctx) return null;
  return (
    entradas.find((e) => ctx.activas.has(e.id) && !(ctx.quedan?.has(e.reglaId) && (ctx.quedan.get(e.reglaId) ?? 0) <= 0)) ??
    null
  );
}

const precioDeCampania = (e: EntradaCampania, idPriceList: string | undefined) =>
  idPriceList ? e.precios.find((p) => p.idPriceList === idPriceList)?.price : undefined;

/** % de descuento real contra `normal`, redondeado hacia abajo (nunca se promete de más). */
const pctReal = (precio: number, normal: number) => Math.floor((1 - precio / normal) * 100 + 1e-9);

export function resolverPrecioVigente(
  prices: AlegraPrice[],
  entradas: readonly EntradaCampania[] | undefined,
  ctx: ContextoCampania | undefined,
  opts: { idListaMedio?: string; precioPrivado?: number | null } = {},
): PrecioResuelto {
  const { idListaMedio, precioPrivado } = opts;
  const entrada = entradaQueRige(entradas, ctx);

  // Cuenta con lista privada: `null` = sin precio en su lista ("Consulte"), nunca cae al público ni
  // a una campaña. Con precio: paga el menor entre su privado y el de campaña de la lista general.
  if (precioPrivado !== undefined) {
    const privado = precioPrivado ?? 0;
    if (precioPrivado !== null && entrada) {
      const general = prices.find((p) => p.main) ?? prices[0];
      const deCampania = precioDeCampania(entrada, general?.idPriceList);
      if (deCampania !== undefined && deCampania > 0 && deCampania < privado) {
        return { precio: deCampania, normal: privado, campania: entrada, pct: pctReal(deCampania, privado) };
      }
    }
    return { precio: privado, normal: privado, campania: null, pct: null };
  }

  const lista = listaQueRige(prices, idListaMedio);
  const normal = lista?.price ?? 0;
  if (entrada && lista) {
    const deCampania = precioDeCampania(entrada, lista.idPriceList);
    if (deCampania !== undefined && deCampania > 0) {
      return { precio: deCampania, normal, campania: entrada, pct: entrada.pct };
    }
  }
  return { precio: normal, normal, campania: null, pct: null };
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** `campanias_online` crudo de la vista → entradas válidas (lo roto se ignora, nunca tira). */
export function mapCampanias(raw: unknown): EntradaCampania[] {
  if (!Array.isArray(raw)) return [];
  const out: EntradaCampania[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const id = str(o.id);
    const reglaId = str(o.reglaId);
    const inicio = str(o.inicio);
    const fin = str(o.fin);
    const pct = num(o.pct);
    if (!id || !reglaId || !inicio || !fin || pct === null || !Array.isArray(o.precios)) continue;
    const precios = (o.precios as unknown[]).flatMap((p) => {
      const q = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
      const idPriceList = q.idPriceList != null ? String(q.idPriceList) : null;
      const price = num(q.price);
      return idPriceList && price !== null ? [{ idPriceList, price }] : [];
    });
    out.push({ id, reglaId, inicio, fin, pct, unidades: num(o.unidades), precios });
  }
  return out;
}
