/**
 * Oráculo de las medidas del banco: mide si la PRIMERA PÁGINA cumple lo que la consulta pidió, contra el valor
 * estructurado real de cada producto, y si el plan produjo la medida. Módulo puro.
 *
 * Es INDEPENDIENTE de la producción: decide el cumplimiento con su propia comparación (no importa
 * `criterioDeMedida` ni el SQL), para que el banco valide el resultado y no se auto-valide. Sólo comparte
 * con producción la gramática de ids (`idDeMedida`/`leerIdMedida`), que es justamente lo que el plan emite.
 *
 * Definiciones sobre el top 24, por par (producto x medida esperada):
 * - con: el producto TIENE dato de la clave (del tipo que la medida pide).
 * - cumple / contradice: con dato que cumple / que no cumple. Sin dato no cumple ni contradice.
 * - precisión = cumple / con (null si nadie tiene dato: "n/a", no 0); contradicciones = cuántos contradicen;
 *   cobertura = con / pares; contradiccionesDuras = contradicciones de las medidas con `dura: true`.
 * - ORDEN (claves discretas con valor exacto: polos, corriente, sensibilidad, zócalo): `inversiones` = pares
 *   (contradice, cumple) donde el que contradice está ANTES en el ranking; `contradicenArriba` = cuántos
 *   contradicen por encima del último que cumple. Los que no tienen dato no cuentan. Objetivo: 0 (el que
 *   cumple va siempre antes que el que contradice; no importa cuántos contradigan si quedan debajo).
 */
import { idDeMedida, leerIdMedida } from "@/lib/catalogo-atributos-medida";
import type { ValorEstructurado } from "@/lib/catalogo-caracteristicas";
import type { ResultadoBanco } from "./banco";
import type { BusquedaBanco, MedidaBanco } from "./modelo";

/**
 * Detalle de UNA medida esperada del caso sobre el top 24 (sólo conteos; los ids de producto son opcionales
 * y el reporte los escribe únicamente con `--ids`). `duras` = `contradice` si la medida es `dura: true`, si no 0.
 */
export interface DetalleMedida {
  clave: string;
  /** Valor esperado en texto ("20", "e27", "10-20", "<=50", ">=20"). */
  valor: string;
  dura: boolean;
  con: number;
  cumple: number;
  contradice: number;
  duras: number;
  /** Pares (contradice, cumple) con el que contradice por encima; 0 si la clave no es discreta o la medida no es un valor exacto. */
  inversiones: number;
  /** Productos que contradicen por encima del último que cumple (misma salvedad). */
  arriba: number;
  /** Ids de los productos del top 24 que contradicen (los que traen id). */
  contradicen: string[];
}

export interface EvaluacionMedida {
  /**
   * El plan produjo todas las medidas esperadas (por su id; con `dura` también entre los duros) y ninguna
   * clave de `sinMedidasDe`. `null`: la tubería no produce medidas, o ninguna esperada tiene id evaluable.
   */
  hit: boolean | null;
  /** cumple / con, sobre los pares; `null` = nadie tiene el dato (n/a) o el caso no tiene medidas esperadas. */
  precision: number | null;
  /** Pares (producto x medida) con dato que NO cumplen; `null` si el caso no tiene medidas esperadas. */
  contradicciones: number | null;
  /** con / pares; `null` si no hay productos o no hay medidas esperadas. */
  cobertura: number | null;
  /** Contradicciones de las medidas `dura: true`; `null` si el caso no tiene ninguna. */
  contradiccionesDuras: number | null;
  /** Suma de `inversiones` de las medidas discretas esperadas; `null` si el caso no tiene ninguna. Objetivo 0. */
  inversiones: number | null;
  /** Suma de `arriba` de esas mismas medidas; `null` si no tiene ninguna. */
  contradicenArriba: number | null;
  /**
   * Casos negativos (`medidas: []` o `sinMedidasDe`): el plan produjo una medida que no debía.
   * `null` = el caso no es negativo o la tubería no produce medidas.
   */
  falsoPositivo: boolean | null;
  /** Ids de medida que el plan produjo; ausente = la tubería no produce medidas. */
  emitidas?: string[];
  /** De `emitidas`, las que quedaron como filtro duro del plan (`atributosDuros`); ausente junto con `emitidas`. */
  emitidasDuras?: string[];
  /** Una entrada por medida esperada (vacío en los casos negativos). */
  detalle: DetalleMedida[];
}

const EPSILON = 1e-9;

/**
 * Claves discretas cuyo ORDEN se mide: el producto que cumple va antes que el que contradice. Se espeja a mano
 * (no se importa de producción) para que el banco valide el resultado y no se auto-valide. Las blandas (potencia,
 * temperatura, flujo) no se miden acá: una potencia cercana no es una contradicción.
 */
export const CLAVES_ORDEN_DISCRETO: readonly string[] = ["polos", "corriente_a", "sensibilidad_ma", "zocalo"];

/** ¿Se mide el orden de esta medida? Discreta y con un valor exacto (un rango no tiene "el que contradice" nítido). */
const mideOrden = (m: MedidaBanco) => CLAVES_ORDEN_DISCRETO.includes(m.clave) && m.valor !== undefined;

/**
 * Inversiones y contradicciones por encima del último que cumple, sobre los veredictos del top en orden de ranking
 * (`true` cumple, `false` contradice, `null` sin dato).
 */
export function ordenDeVeredictos(veredictos: readonly (boolean | null)[]): { inversiones: number; arriba: number } {
  let contradicenAntes = 0;
  let inversiones = 0;
  let arriba = 0;
  for (const v of veredictos) {
    if (v === false) contradicenAntes++;
    else if (v === true) {
      inversiones += contradicenAntes;
      arriba = contradicenAntes;
    }
  }
  return { inversiones, arriba };
}

/** Rango "a-b" del texto (tensión de entrada "85-265", regulación de un relé térmico "4-6"); espejo propio, no de producción. */
function rangoDeTexto(t: string | null): [number, number] | null {
  const m = t ? /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(t) : null;
  return m && Number(m[1]) < Number(m[2]) ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * ¿El valor estructurado cumple la medida? `null` = sin dato del tipo que la medida pide. Un valor exacto pedido
 * (5 A, 110 V) lo cumple también un rango de texto que lo contiene: un relé térmico de regulación 4-6 A sirve para
 * 5 A aunque su número guardado sea el tope.
 */
export function cumpleMedida(m: MedidaBanco, v: ValorEstructurado | undefined): boolean | null {
  if (typeof m.valor === "string") {
    if (!v || v.t === null) return null;
    return v.t.toLowerCase() === m.valor.toLowerCase();
  }
  const rango = typeof m.valor === "number" && m.clave !== "ip" && v ? rangoDeTexto(v.t) : null;
  if (rango && m.valor! >= rango[0] - EPSILON && m.valor! <= rango[1] + EPSILON) return true;
  if (!v || v.n === null) return null;
  if (typeof m.valor === "number") return m.clave === "ip" ? v.n >= m.valor - EPSILON : Math.abs(v.n - m.valor) < EPSILON;
  return (m.min === undefined || v.n >= m.min - EPSILON) && (m.max === undefined || v.n <= m.max + EPSILON);
}

/** Id con que el plan debería producir la medida; `null` si no tiene id (un solo extremo de rango). */
function idEsperado(m: MedidaBanco): string | null {
  if (m.valor !== undefined) return idDeMedida({ clave: m.clave, op: "eq", valor: m.valor });
  if (m.min !== undefined && m.max !== undefined) return idDeMedida({ clave: m.clave, op: "entre", min: m.min, max: m.max });
  return null;
}

/**
 * Ids del diccionario de atributos que equivalen a una medida (el plan prefiere el del diccionario al
 * dinámico, spec R6.8): zócalo e27/e14/gu10/mr16, tensión 12/24/220 V e IP 65 a 68 (`apto-exterior`).
 * Se espeja a mano (no se importa el diccionario) para que el banco no dependa de la producción.
 */
function idsDeDiccionario(m: MedidaBanco): string[] {
  if (m.clave === "zocalo" && typeof m.valor === "string" && ["e27", "e14", "gu10", "mr16"].includes(m.valor)) return [`zocalo-${m.valor}`];
  if (m.clave === "tension_v" && typeof m.valor === "number" && [12, 24, 220].includes(m.valor)) return [`tension-${m.valor}v`];
  if (m.clave === "ip" && typeof m.valor === "number" && m.valor >= 65 && m.valor <= 68) return ["apto-exterior"];
  return [];
}

const CLAVE_DE_DICCIONARIO: readonly [RegExp, string][] = [
  [/^zocalo-/, "zocalo"],
  [/^tension-/, "tension_v"],
  [/^apto-exterior$/, "ip"],
];

/** Clave de un id de medida, dinámico (`clave:valor`) o del diccionario equivalente. */
export const claveDeId = (id: string): string | undefined => leerIdMedida(id)?.clave ?? CLAVE_DE_DICCIONARIO.find(([re]) => re.test(id))?.[1];

/** Valor esperado como texto: igual, rango o un solo extremo. */
function valorEsperado(m: MedidaBanco): string {
  if (m.valor !== undefined) return String(m.valor);
  if (m.min !== undefined && m.max !== undefined) return `${m.min}-${m.max}`;
  return m.min !== undefined ? `>=${m.min}` : `<=${m.max}`;
}

export function evaluarMedidas(b: BusquedaBanco, r: ResultadoBanco): EvaluacionMedida | undefined {
  const esperadas = b.medidas ?? [];
  const sinDe = b.sinMedidasDe ?? [];
  if (b.medidas === undefined && !sinDe.length) return undefined;

  const emitidas = r.medidas;
  const clavesEmitidas = new Set<string | undefined>((emitidas ?? []).map(claveDeId));

  // Negativos: `medidas: []` (ninguna medida) o claves prohibidas.
  const negativo = b.medidas?.length === 0 || sinDe.length > 0;
  const emitioProhibida = (emitidas ?? []).length > 0 && (b.medidas?.length === 0 || sinDe.some((c) => clavesEmitidas.has(c)));
  const falsoPositivo = negativo && emitidas !== undefined ? emitioProhibida : null;

  // hit
  let hit: boolean | null = null;
  if (emitidas !== undefined) {
    const conId = esperadas.flatMap((m) => {
      const id = idEsperado(m);
      return id === null ? [] : [{ m, ids: [id, ...idsDeDiccionario(m)] }];
    });
    const faltante = conId.some(({ m, ids }) => !ids.some((id) => emitidas.includes(id)) || (m.dura && !ids.some((id) => r.atributosDuros.includes(id))));
    const prohibida = sinDe.some((c) => clavesEmitidas.has(c));
    if (conId.length || sinDe.length) hit = !faltante && !prohibida;
  }

  const trazaPlan = emitidas ? { emitidas: [...emitidas], emitidasDuras: emitidas.filter((id) => r.atributosDuros.includes(id)) } : {};

  if (!esperadas.length) {
    return { hit: null, precision: null, contradicciones: null, cobertura: null, contradiccionesDuras: null, inversiones: null, contradicenArriba: null, falsoPositivo, ...trazaPlan, detalle: [] };
  }

  const top = r.productos.slice(0, 24);
  let con = 0;
  let cumplen = 0;
  let contradicciones = 0;
  let contradiccionesDuras = 0;
  const detalle: DetalleMedida[] = [];
  for (const m of esperadas) {
    const d: DetalleMedida = { clave: m.clave, valor: valorEsperado(m), dura: !!m.dura, con: 0, cumple: 0, contradice: 0, duras: 0, inversiones: 0, arriba: 0, contradicen: [] };
    const veredictos: (boolean | null)[] = [];
    for (const p of top) {
      const ok = cumpleMedida(m, p.atributosEstructurados?.[m.clave as keyof NonNullable<typeof p.atributosEstructurados>]);
      veredictos.push(ok);
      if (ok === null) continue;
      con++;
      d.con++;
      if (ok) {
        cumplen++;
        d.cumple++;
      } else {
        contradicciones++;
        d.contradice++;
        if (p.id !== undefined) d.contradicen.push(p.id);
        if (m.dura) {
          contradiccionesDuras++;
          d.duras++;
        }
      }
    }
    if (mideOrden(m)) {
      const orden = ordenDeVeredictos(veredictos);
      d.inversiones = orden.inversiones;
      d.arriba = orden.arriba;
    }
    detalle.push(d);
  }
  const conOrden = esperadas.some(mideOrden);
  const pares = esperadas.length * top.length;
  return {
    hit,
    precision: con ? cumplen / con : null,
    contradicciones,
    cobertura: pares ? con / pares : null,
    contradiccionesDuras: esperadas.some((m) => m.dura) ? contradiccionesDuras : null,
    inversiones: conOrden ? detalle.reduce((t, d) => t + d.inversiones, 0) : null,
    contradicenArriba: conOrden ? detalle.reduce((t, d) => t + d.arriba, 0) : null,
    falsoPositivo,
    ...trazaPlan,
    detalle,
  };
}
