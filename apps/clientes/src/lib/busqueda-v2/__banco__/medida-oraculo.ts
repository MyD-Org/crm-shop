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
 */
import { idDeMedida, leerIdMedida } from "@/lib/catalogo-atributos-medida";
import type { ValorEstructurado } from "@/lib/catalogo-caracteristicas";
import type { ResultadoBanco } from "./banco";
import type { BusquedaBanco, MedidaBanco } from "./modelo";

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
  /**
   * Casos negativos (`medidas: []` o `sinMedidasDe`): el plan produjo una medida que no debía.
   * `null` = el caso no es negativo o la tubería no produce medidas.
   */
  falsoPositivo: boolean | null;
}

const EPSILON = 1e-9;

/** ¿El valor estructurado cumple la medida? `null` = sin dato del tipo que la medida pide. */
export function cumpleMedida(m: MedidaBanco, v: ValorEstructurado | undefined): boolean | null {
  if (typeof m.valor === "string") {
    if (!v || v.t === null) return null;
    return v.t.toLowerCase() === m.valor.toLowerCase();
  }
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
const claveDeId = (id: string): string | undefined => leerIdMedida(id)?.clave ?? CLAVE_DE_DICCIONARIO.find(([re]) => re.test(id))?.[1];

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

  if (!esperadas.length) {
    return { hit: null, precision: null, contradicciones: null, cobertura: null, contradiccionesDuras: null, falsoPositivo };
  }

  const top = r.productos.slice(0, 24);
  let con = 0;
  let cumplen = 0;
  let contradicciones = 0;
  let contradiccionesDuras = 0;
  for (const m of esperadas) {
    for (const p of top) {
      const ok = cumpleMedida(m, p.atributosEstructurados?.[m.clave as keyof NonNullable<typeof p.atributosEstructurados>]);
      if (ok === null) continue;
      con++;
      if (ok) cumplen++;
      else {
        contradicciones++;
        if (m.dura) contradiccionesDuras++;
      }
    }
  }
  const pares = esperadas.length * top.length;
  return {
    hit,
    precision: con ? cumplen / con : null,
    contradicciones,
    cobertura: pares ? con / pares : null,
    contradiccionesDuras: esperadas.some((m) => m.dura) ? contradiccionesDuras : null,
    falsoPositivo,
  };
}
