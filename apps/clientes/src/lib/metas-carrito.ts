/**
 * Metas del carrito que se muestran como barras (envío gratis, más cuotas sin interés). Módulo puro:
 * arma las metas a partir de lo calculado y las ordena, la más cercana primero.
 */
import { TEXTOS_CUOTAS } from "./cuotas-textos";
import { fmtPrecio } from "./format";
import type { ProgresoCuotas } from "./cuotas-sin-interes";

export interface MetaCarrito {
  id: "envio" | "cuotas";
  texto: string;
  /** Fragmento de `texto` que se resalta (el monto que falta); ausente = sin énfasis. */
  enfasis?: string;
  /**
   * Segunda línea, ARRIBA de `texto`, con lo ya alcanzado (ej. "Ya tiene 8 cuotas sin interés de
   * $20.000."): `texto` y la barra quedan para el próximo nivel. Ausente = una sola línea.
   */
  textoAlcanzado?: string;
  /** Fragmento de `textoAlcanzado` que se resalta. */
  enfasisAlcanzado?: string;
  /** 0..100 */
  pct: number;
  alcanzada: boolean;
  aria: string;
}

export function metaEnvio(p: { faltante: number; pct: number; alcanzado: boolean } | null): MetaCarrito | null {
  if (!p) return null;
  return {
    id: "envio",
    texto: p.alcanzado
      ? "Su compra tiene envío a domicilio gratis"
      : `Le faltan ${fmtPrecio(p.faltante)} sin impuestos para el envío gratis`,
    pct: p.pct,
    alcanzada: p.alcanzado,
    aria: "Progreso hacia el envío gratis",
  };
}

/** Sin progreso (flag apagado, cuenta corriente, sin mínimos) o sin cuotas que informar: null. */
export function metaCuotas(p: ProgresoCuotas | null | undefined): MetaCarrito | null {
  if (!p) return null;
  if (p.proximo) {
    const alcanzado =
      p.cuotasActuales !== null && p.montoCuota != null
        ? {
            textoAlcanzado: TEXTOS_CUOTAS.yaTiene(p.cuotasActuales, p.montoCuota),
            enfasisAlcanzado: TEXTOS_CUOTAS.cuotasConMonto(p.cuotasActuales, p.montoCuota),
          }
        : {};
    return {
      id: "cuotas",
      texto: TEXTOS_CUOTAS.faltaParaCuotas(p.proximo.falta, p.proximo.cuotas),
      enfasis: TEXTOS_CUOTAS.montoFaltante(p.proximo.falta),
      ...alcanzado,
      pct: p.pct,
      alcanzada: false,
      aria: TEXTOS_CUOTAS.barraAria,
    };
  }
  if (p.cuotasActuales === null) return null;
  return {
    id: "cuotas",
    texto:
      p.montoCuota != null
        ? TEXTOS_CUOTAS.compraYaTiene(p.cuotasActuales, p.montoCuota)
        : TEXTOS_CUOTAS.cuotasCompletas(p.cuotasActuales),
    pct: 100,
    alcanzada: true,
    aria: TEXTOS_CUOTAS.barraAria,
  };
}

/** Las metas presentes, la más cercana (mayor avance) primero; a igual avance, envío antes que cuotas. */
export function ordenarMetas(metas: readonly (MetaCarrito | null)[]): MetaCarrito[] {
  const peso = (m: MetaCarrito) => (m.id === "envio" ? 0 : 1);
  return metas.filter((m): m is MetaCarrito => m !== null).sort((a, b) => b.pct - a.pct || peso(a) - peso(b));
}
