/**
 * Las medidas de la consulta ("termica 2x20", "lampara 9,5w e27", "bipolar 20a") dentro del plan.
 * `aplicarMedidas` MERGEA al plan, DESPUÉS de resolverlo (caché o Entender), los ids de medida que
 * pidió la consulta cruda. Nunca se persisten: el plan que guarda `busqueda_interpretaciones` no
 * las trae, así que apagar el flag o cambiar la política no deja nada que invalidar.
 *
 * Módulo PURO salvo por las dependencias inyectadas (los conteos). Se llama desde UN solo punto:
 * `servidor.obtener` (y, igual, `obtenerPlan` del banco). `entender()` y `combinar()` no cambian.
 *
 * Política (tabla `POLITICA`, en código: cambiarla es un deploy y se mide con el banco):
 * - confianza baja: no se emite; media: sólo ordena (blando, 0,9); alta: puede ser filtro duro;
 * - duras (por clave): polos, corriente_a, sensibilidad_ma, zócalo. Todo lo demás ordena;
 * - potencia NUNCA es dura: un par exacto + banda (±1 W bajo 10 W, si no ±10 %) que ordena;
 * - lo que el diccionario ya tiene (12/24/220 V, E27/E14/GU10/MR16, IP65-68 = apto exterior) se
 *   emite con el id del diccionario; los ids dinámicos (`clave:valor`) cubren el resto.
 *
 * Semántica de un filtro duro (la decide el SQL con `universoAcotado`, la misma ancla que usa acá):
 * - con ANCLA (categoría dura o términos fuertes): "sin contradicción". Excluye sólo al producto
 *   que tiene la clave con OTRO valor; sin dato pasa y queda debajo. Exige que la clave tenga
 *   cobertura (>= 80 % de >= 20 productos del universo): si casi nadie tiene el dato, el filtro
 *   no filtraría nada;
 * - sin ancla ("20a", "bipolar 20a"): POSITIVA (sólo lo que cumple); "sin contradicción" sin
 *   universo devolvería el catálogo entero.
 * En los dos casos un guard de conjunto evita dejar la página sin resultados (todo o nada: si falla
 * degradan a blando TODAS las duras).
 */
import type { ClaveEstructurada } from "../../catalogo-caracteristicas";
import { atributoPorId, type AtributoResuelto } from "../../catalogo-atributos";
import { esMedidaId, idDeMedida, RANGOS, type ClaveMedida } from "../../catalogo-atributos-medida";
import type { PlanBusqueda } from "../plan";
import { terminosQueRecuperan } from "../recuperar";
import { universoAcotado } from "../universo-acotado";
import { medidasDeConsulta, type Medida } from "./medidas";

/** Una clave dura exige que al menos esta fracción de los productos del universo tenga el dato. */
export const UMBRAL_COBERTURA_DURA = 0.8;
/** ...y que el universo tenga por lo menos esta cantidad de productos (sin muestra no hay cobertura). */
export const MINIMO_PRODUCTOS_COBERTURA = 20;
/** Con las medidas duras puestas tiene que quedar al menos esto (como `MINIMO_ATRIBUTO_DURO` de combinar). */
export const MINIMO_MEDIDA_DURA = 3;
/** ...y, con ancla, al menos esto cumpliendo de verdad (si nadie la cumple, el filtro sólo muestra productos sin dato). */
export const MINIMO_QUE_CUMPLEN = 1;
/** Medida blanda (confianza media o clave no dura): ordena como un atributo explícito del plan. */
export const PESO_MEDIDA_BLANDA = 0.9;
/** Boost de una medida dura: los que SÍ tienen el dato suben sobre los que no lo tienen. */
export const PESO_MEDIDA_DURA = 1;
/** Potencia: exacto y banda suman 0,5 cada uno (3 × 0,5 + 3 × 0,5 = +3 el exacto; +1,5 sólo la banda). */
export const PESO_POTENCIA_EXACTA = 0.5;
export const PESO_POTENCIA_BANDA = 0.5;
/** Tope de blandos de medida en un plan. */
export const TOPE_BLANDOS_MEDIDA = 6;
/** Bajo este valor la banda de potencia es de ±1 W; desde acá, ±10 %. */
const POTENCIA_BANDA_ABSOLUTA_HASTA_W = 10;

export interface PoliticaClave {
  /** Puede ser filtro duro (con confianza alta, ancla/semántica, cobertura y guard). */
  duro: boolean;
  /** `potencia`: par exacto + banda con tolerancia. */
  tolerancia?: "potencia";
}

export const POLITICA: Readonly<Record<ClaveMedida, PoliticaClave>> = {
  polos: { duro: true },
  corriente_a: { duro: true },
  sensibilidad_ma: { duro: true },
  zocalo: { duro: true },
  tension_v: { duro: false },
  ip: { duro: false },
  potencia_w: { duro: false, tolerancia: "potencia" },
  flujo_lm: { duro: false },
  temperatura_k: { duro: false },
  curva: { duro: false },
  seccion_mm2: { duro: false },
  largo_m: { duro: false },
  poder_corte_ka: { duro: false },
  angulo_grados: { duro: false },
  medidas_mm: { duro: false },
};

/** El universo sobre el que se cuenta: lo que ya filtra el plan, sin las medidas que se están decidiendo. */
export interface UniversoMedida {
  categorias: string[];
  atributos: string[];
  terminos?: string[];
}

export type ContarMedidas = (filtros: UniversoMedida & { conClaves?: ClaveEstructurada[] }) => Promise<number>;

export interface DepsMedidas {
  /** Flag `busqueda-medidas` (leído por el llamador en cada request). Apagado: el plan vuelve igual. */
  activo: boolean;
  /** La tabla de atributos estructurados existe: sin ella el filtro duro no restringe nada. */
  estructurados: boolean;
  /** Cuántos productos dejan esos filtros (con las medidas "sin contradicción" según el universo). */
  contar: ContarMedidas;
  /** Lo mismo, con las medidas POSITIVAS: cuántos cumplen de verdad. */
  contarPositivo: ContarMedidas;
  /** Cuántos del universo tienen dato de la clave (`con`) y cuántos hay (`total`). */
  cobertura: (universo: UniversoMedida, clave: ClaveMedida) => Promise<{ con: number; total: number }>;
}

/**
 * `cobertura` con un `contar` que acepta `conClaves`: `con` = el universo filtrado a los que tienen
 * valor de la clave; `total` = el universo. El total de un mismo universo se cuenta una sola vez.
 */
export function coberturaConContar(contar: ContarMedidas): DepsMedidas["cobertura"] {
  const totales = new Map<string, Promise<number>>();
  return async (universo, clave) => {
    const llave = JSON.stringify(universo);
    let total = totales.get(llave);
    if (!total) {
      total = contar(universo);
      totales.set(llave, total);
    }
    const [con, n] = await Promise.all([contar({ ...universo, conClaves: [clave] }), total]);
    return { con, total: n };
  };
}

// ---------------------------------------------------------------------------------------------
// Ids del diccionario equivalentes a una medida (R6.8)
// ---------------------------------------------------------------------------------------------

const ZOCALOS_DICCIONARIO = ["e27", "e14", "gu10", "mr16"];

/** Id del diccionario que equivale a la medida (eq), o `undefined`: se prefiere al dinámico. */
function idDeDiccionario(m: Medida): string | undefined {
  if (m.op !== "eq") return undefined;
  if (m.clave === "zocalo" && typeof m.valor === "string" && ZOCALOS_DICCIONARIO.includes(m.valor)) return `zocalo-${m.valor}`;
  if (m.clave === "tension_v" && typeof m.valor === "number") {
    if (m.valor === 12 || m.valor === 24) return `tension-${m.valor}v`;
    if (m.valor === 220 || m.valor === 230) return "tension-220v";
  }
  if (m.clave === "ip" && typeof m.valor === "number" && m.valor >= 65 && m.valor <= 68) return "apto-exterior";
  return undefined;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Banda de potencia alrededor de `v`: ±1 W bajo 10 W, si no ±10 %; dentro del rango válido de la clave. */
function bandaDePotencia(v: number): { min: number; max: number } {
  const [rangoMin, rangoMax] = RANGOS.potencia_w ?? [0.1, 100_000];
  const delta = v < POTENCIA_BANDA_ABSOLUTA_HASTA_W ? 1 : v * 0.1;
  return { min: Math.max(rangoMin, redondear(v - delta)), max: Math.min(rangoMax, redondear(v + delta)) };
}

// ---------------------------------------------------------------------------------------------
// aplicarMedidas
// ---------------------------------------------------------------------------------------------

interface Candidata {
  medida: Medida;
  id: string;
}

export interface MedidasAplicadas {
  plan: PlanBusqueda;
  /** Ids de medida de la consulta: dinámicos y del diccionario (estén o no ya en el plan). Para el banco. */
  ids: string[];
}

const sinMedidas = (plan: PlanBusqueda): PlanBusqueda => {
  const duros = plan.duros.atributos.filter((id) => !esMedidaId(id));
  const blandos = plan.blandos.atributos.filter((a) => !esMedidaId(a.id));
  if (duros.length === plan.duros.atributos.length && blandos.length === plan.blandos.atributos.length) return plan;
  return { ...plan, duros: { ...plan.duros, atributos: duros }, blandos: { ...plan.blandos, atributos: blandos } };
};

const claveDelId = (id: string): string | undefined => {
  const a: AtributoResuelto | undefined = atributoPorId(id);
  return a?.estructurado?.clave;
};

/**
 * Quita del plan los ids del diccionario de la misma clave pero con otro valor que una medida EXPLÍCITA de
 * confianza alta ("12v" explícito y Jev inferiendo 24 V): la que escribió la persona manda (C16).
 */
function sinContradichos(plan: PlanBusqueda, medidas: readonly Medida[]): PlanBusqueda {
  const objetivos = new Map<string, string | undefined>();
  for (const m of medidas) if (m.confianza === "alta" && (m.op === "eq" || m.op === "entre")) objetivos.set(m.clave, idDeDiccionario(m));
  if (!objetivos.size) return plan;
  const contradice = (id: string) => {
    if (esMedidaId(id)) return false;
    const clave = claveDelId(id);
    return clave !== undefined && objetivos.has(clave) && objetivos.get(clave) !== id;
  };
  const duros = plan.duros.atributos.filter((id) => !contradice(id));
  const blandos = plan.blandos.atributos.filter((a) => !contradice(a.id));
  if (duros.length === plan.duros.atributos.length && blandos.length === plan.blandos.atributos.length) return plan;
  return { ...plan, duros: { ...plan.duros, atributos: duros }, blandos: { ...plan.blandos, atributos: blandos } };
}

/** Une `nuevos` a los blandos del plan sin duplicar ids (gana el mayor peso). */
function sumarBlandos(existentes: PlanBusqueda["blandos"]["atributos"], nuevos: readonly { id: string; peso: number }[]) {
  const mapa = new Map(existentes.map((a) => [a.id, a.peso]));
  for (const n of nuevos) mapa.set(n.id, Math.max(n.peso, mapa.get(n.id) ?? 0));
  return [...mapa].map(([id, peso]) => ({ id, peso }));
}

/**
 * Núcleo: tira ante un error de los conteos. `aplicarMedidasConIds` y `aplicarMedidas` lo envuelven
 * (el servidor lo usa directo para no guardar en su memo una decisión que falló).
 */
export async function calcularMedidas(plan: PlanBusqueda, consultaCruda: string, deps: DepsMedidas): Promise<MedidasAplicadas> {
  if (!deps.activo || plan.intencion === "codigo") return { plan, ids: [] };

  // 1. Idempotencia: lo que traiga el plan de una corrida anterior (o sembrado a mano) se recalcula.
  let base = sinMedidas(plan);

  // 2. Medidas de la consulta CRUDA ("9,5w": la normalizada es "9 5w"). La confianza baja no se usa.
  const medidas = medidasDeConsulta(consultaCruda).filter((m) => m.confianza !== "baja");
  if (!medidas.length) return { plan: base, ids: [] };

  base = sinContradichos(base, medidas);

  const ids: string[] = [];
  const blandos: { id: string; peso: number }[] = [];
  const candidatasDuras: Candidata[] = [];
  const yaEnElPlan = (id: string) => base.duros.atributos.includes(id) || base.blandos.atributos.some((a) => a.id === id);
  const registrar = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };

  for (const m of medidas) {
    // Un solo extremo ("hasta 50w") no tiene id: lo cubre el rango de potencia (cambio aparte).
    if (m.op === "lte" || m.op === "gte") continue;

    const dic = idDeDiccionario(m);
    if (dic) {
      registrar(dic);
      if (!yaEnElPlan(dic)) blandos.push({ id: dic, peso: PESO_MEDIDA_BLANDA });
      continue;
    }

    if (POLITICA[m.clave].tolerancia === "potencia") {
      if (m.op === "eq" && typeof m.valor === "number") {
        const exacta = idDeMedida({ clave: m.clave, op: "eq", valor: m.valor });
        const { min, max } = bandaDePotencia(m.valor);
        const banda = idDeMedida({ clave: m.clave, op: "entre", min, max });
        if (exacta) {
          registrar(exacta);
          blandos.push({ id: exacta, peso: PESO_POTENCIA_EXACTA });
        }
        if (banda) {
          registrar(banda);
          blandos.push({ id: banda, peso: PESO_POTENCIA_BANDA });
        }
      } else if (m.op === "entre") {
        const banda = idDeMedida({ clave: m.clave, op: "entre", min: m.min, max: m.max });
        if (banda) {
          registrar(banda);
          blandos.push({ id: banda, peso: PESO_POTENCIA_BANDA });
        }
      }
      continue;
    }

    const id = idDeMedida({ clave: m.clave, op: m.op, valor: m.valor, min: m.min, max: m.max });
    if (!id) continue;
    registrar(id);
    // medidas_mm: el valor y cada lectura alternativa (cm o mm) ordenan, nunca filtran.
    for (const alternativa of m.alternativas ?? []) {
      const idAlt = idDeMedida({ clave: m.clave, op: "eq", valor: alternativa });
      if (idAlt) {
        registrar(idAlt);
        blandos.push({ id: idAlt, peso: PESO_MEDIDA_BLANDA });
      }
    }
    if (m.op === "eq" && m.confianza === "alta" && POLITICA[m.clave].duro) candidatasDuras.push({ medida: m, id });
    else blandos.push({ id, peso: PESO_MEDIDA_BLANDA });
  }

  // 3. ¿Cuáles de las candidatas pueden ser filtro duro?
  let duras: Candidata[] = [];
  if (candidatasDuras.length && deps.estructurados && base.intencion !== "pregunta") {
    duras = await decidirDuras(base, candidatasDuras, deps);
  }
  for (const c of candidatasDuras) if (!duras.includes(c)) blandos.push({ id: c.id, peso: PESO_MEDIDA_BLANDA });

  // 4. Emisión: las duras van a los duros y, con peso 1, a los blandos (suben los que sí tienen el dato).
  const boosts = duras.map((c) => ({ id: c.id, peso: PESO_MEDIDA_DURA }));
  const emitidos = [...boosts, ...blandos.filter((b) => !boosts.some((x) => x.id === b.id))];
  const conTope = emitidos.filter((b) => esMedidaId(b.id)).slice(0, TOPE_BLANDOS_MEDIDA);
  const delDiccionario = emitidos.filter((b) => !esMedidaId(b.id));

  const resultado: PlanBusqueda = {
    ...base,
    duros: { ...base.duros, atributos: [...base.duros.atributos, ...duras.map((c) => c.id)] },
    blandos: { ...base.blandos, atributos: sumarBlandos(base.blandos.atributos, [...delDiccionario, ...conTope]) },
  };
  // Sólo los ids que llegaron al plan (el tope puede dejar alguno afuera); los del diccionario cuentan aunque ya estuvieran.
  const enElPlan = new Set([...resultado.duros.atributos, ...resultado.blandos.atributos.map((a) => a.id)]);
  return { plan: resultado, ids: ids.filter((id) => enElPlan.has(id) || !esMedidaId(id)) };
}

/** Las candidatas que pasan a duras (todo o nada), o `[]`. */
async function decidirDuras(plan: PlanBusqueda, candidatas: Candidata[], deps: DepsMedidas): Promise<Candidata[]> {
  const universo: UniversoMedida = {
    categorias: [...plan.duros.categorias],
    atributos: [...plan.duros.atributos],
    terminos: terminosQueRecuperan(plan),
  };
  // La MISMA ancla con la que catalog.ts elige la semántica del filtro (ver universoAcotado).
  const ancla = universoAcotado({ categorias: plan.duros.categorias, planBusqueda: plan });
  let elegidas = candidatas;

  if (ancla) {
    // "Sin contradicción" sólo tiene sentido si la clave está cargada en casi todo el universo.
    const conCobertura: Candidata[] = [];
    for (const c of candidatas) {
      const { con, total } = await deps.cobertura(universo, c.medida.clave);
      if (total >= MINIMO_PRODUCTOS_COBERTURA && con / total >= UMBRAL_COBERTURA_DURA) conCobertura.push(c);
    }
    elegidas = conCobertura;
    if (!elegidas.length) return [];
  }

  const filtros = { ...universo, atributos: [...universo.atributos, ...elegidas.map((c) => c.id)] };
  if (ancla) {
    if ((await deps.contar(filtros)) < MINIMO_MEDIDA_DURA) return [];
    if ((await deps.contarPositivo(filtros)) < MINIMO_QUE_CUMPLEN) return [];
  } else if ((await deps.contarPositivo(filtros)) < MINIMO_MEDIDA_DURA) {
    return [];
  }
  return elegidas;
}

/**
 * `aplicarMedidas` con los ids de medida que produjo (para el banco). Ante cualquier error devuelve el
 * plan sin tocar y avisa sólo el TIPO del error (nunca la consulta).
 */
export async function aplicarMedidasConIds(plan: PlanBusqueda, consultaCruda: string, deps: DepsMedidas): Promise<MedidasAplicadas> {
  try {
    return await calcularMedidas(plan, consultaCruda, deps);
  } catch (err) {
    console.error(`[busqueda-medidas] no se pudieron aplicar las medidas: ${err instanceof Error ? err.name : "desconocido"}`);
    return { plan, ids: [] };
  }
}

export async function aplicarMedidas(plan: PlanBusqueda, consultaCruda: string, deps: DepsMedidas): Promise<PlanBusqueda> {
  return (await aplicarMedidasConIds(plan, consultaCruda, deps)).plan;
}
