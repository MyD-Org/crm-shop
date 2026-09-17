/**
 * Adaptador de cuotas de Mercado Pago. SOLO servidor (usa MP_ACCESS_TOKEN).
 *
 * `GET /v1/payment_methods/installments?amount=10000&payment_method_id={medio}`
 * devuelve una entrada por emisor, cada una con sus `payer_costs`. La tasa es %
 * sobre el contado, así que una sola llamada con un monto de referencia sirve
 * para cualquier monto.
 *
 * La normalización es pura (`normalizarInstallmentsMP`) y conservadora: por
 * cantidad de cuotas se toma la tasa MÁS ALTA entre emisores (no prometer de
 * menos) con el CFT/TEA de esa misma entrada, y el rango de montos más
 * restrictivo. Ningún campo propio de MP sale de este archivo.
 */
import type { PlanDeCuotas } from "../cuotas-tipos";
import type { ProveedorCuotas, ResultadoPlanesMedio } from "./tipos";

const ID = "mercadopago";
const API = "https://api.mercadopago.com/v1/payment_methods/installments";
const MONTO_REFERENCIA = 10000;
const TIMEOUT_MS = 10_000;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const finito = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** "45,67" → 45.67; "1.234,50" → 1234.5; "12.5" → 12.5. */
function numeroAR(s: string): number | null {
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Extrae CFT y TEA de labels tipo `CFT_45,67%|TEA_12,34%`. */
export function parsearLabelsMP(labels: unknown): { cftPct: number | null; teaPct: number | null } {
  let cftPct: number | null = null;
  let teaPct: number | null = null;
  if (!Array.isArray(labels)) return { cftPct, teaPct };
  for (const l of labels) {
    if (typeof l !== "string") continue;
    const cft = /CFT_([\d.,]+)%/.exec(l);
    const tea = /TEA_([\d.,]+)%/.exec(l);
    if (cft && cftPct === null) cftPct = numeroAR(cft[1]);
    if (tea && teaPct === null) teaPct = numeroAR(tea[1]);
  }
  return { cftPct, teaPct };
}

/** Normaliza la respuesta cruda de /installments a planes neutrales. */
export function normalizarInstallmentsMP(medio: string, crudo: unknown): PlanDeCuotas[] {
  if (!Array.isArray(crudo)) return [];
  const porCuotas = new Map<number, PlanDeCuotas>();

  for (const emisor of crudo) {
    if (!esObjeto(emisor) || !Array.isArray(emisor.payer_costs)) continue;
    for (const pc of emisor.payer_costs) {
      if (!esObjeto(pc)) continue;
      const cuotas = pc.installments;
      const tasa = pc.installment_rate;
      if (!Number.isInteger(cuotas) || (cuotas as number) < 1 || !finito(tasa) || tasa < 0) continue;

      const { cftPct, teaPct } = parsearLabelsMP(pc.labels);
      const min = finito(pc.min_allowed_amount) ? pc.min_allowed_amount : null;
      const max = finito(pc.max_allowed_amount) ? pc.max_allowed_amount : null;
      const previo = porCuotas.get(cuotas as number);

      if (!previo) {
        porCuotas.set(cuotas as number, {
          proveedor: ID,
          medio,
          cuotas: cuotas as number,
          tasaPct: tasa,
          cftPct,
          teaPct,
          montoMin: min,
          montoMax: max,
        });
        continue;
      }
      if (tasa > previo.tasaPct) {
        previo.tasaPct = tasa;
        previo.cftPct = cftPct;
        previo.teaPct = teaPct;
      }
      if (min !== null) previo.montoMin = previo.montoMin === null ? min : Math.max(previo.montoMin, min);
      if (max !== null) previo.montoMax = previo.montoMax === null ? max : Math.min(previo.montoMax, max);
    }
  }

  return [...porCuotas.values()].sort((a, b) => a.cuotas - b.cuotas);
}

export function crearProveedorMercadoPago(opts: {
  fetch?: FetchLike;
  token: string | undefined;
  timeoutMs?: number;
}): ProveedorCuotas {
  const fetchFn: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  async function consultar(medio: string): Promise<PlanDeCuotas[]> {
    if (!opts.token) throw new Error("Falta MP_ACCESS_TOKEN en el entorno.");
    const url = `${API}?amount=${MONTO_REFERENCIA}&payment_method_id=${encodeURIComponent(medio)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        headers: { Authorization: `Bearer ${opts.token}` },
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const planes = normalizarInstallmentsMP(medio, await res.json());
      if (planes.length === 0) throw new Error("respuesta sin planes");
      return planes;
    } finally {
      clearTimeout(timer);
    }
  }

  async function obtenerPlanesPorMedio(medios: string[]): Promise<ResultadoPlanesMedio[]> {
    const unicos = [...new Set(medios)];
    const resultados = await Promise.allSettled(unicos.map(consultar));
    return resultados.map((r, i): ResultadoPlanesMedio =>
      r.status === "fulfilled"
        ? { medio: unicos[i], ok: true, planes: r.value }
        : {
            medio: unicos[i],
            ok: false,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          },
    );
  }

  return {
    id: ID,
    mediosPorDefecto: ["visa", "master"],
    obtenerPlanesPorMedio,
    async obtenerPlanes(medios) {
      const resultados = await obtenerPlanesPorMedio(medios);
      const buenos = resultados.filter((r) => r.ok);
      if (buenos.length === 0) {
        const detalle = resultados.map((r) => `${r.medio}: ${r.ok ? "ok" : r.error}`).join("; ");
        throw new Error(`Mercado Pago no devolvió planes (${detalle || "sin medios"})`);
      }
      return buenos.flatMap((r) => (r.ok ? r.planes : []));
    },
  };
}

/** Instancia de producción: token del entorno leído en cada consulta. */
export const cuotasMercadoPago: ProveedorCuotas = {
  id: ID,
  mediosPorDefecto: ["visa", "master"],
  obtenerPlanes: (medios) =>
    crearProveedorMercadoPago({ token: process.env.MP_ACCESS_TOKEN }).obtenerPlanes(medios),
  obtenerPlanesPorMedio: (medios) =>
    crearProveedorMercadoPago({ token: process.env.MP_ACCESS_TOKEN }).obtenerPlanesPorMedio(medios),
};
