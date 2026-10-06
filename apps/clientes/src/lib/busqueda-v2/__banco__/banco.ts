/**
 * Banco de búsquedas (spec búsqueda v2, platform 2026-10-01): tipos, carga y
 * evaluación por etapa. Módulo puro: lo usan el test offline (Entender, con
 * las respuestas grabadas de Jev) y el script en vivo `npm run banco:busqueda`
 * (las tres etapas contra la base de `.env.local`).
 *
 * La evaluación no sabe qué tubería corrió: recibe un `ResultadoBanco` (lo que
 * se entendió y la primera página) y lo compara con las expectativas. Así la
 * fase 1 (línea de base) y la v2 se miden con la misma vara.
 */
import banco from "./banco.json";
import { parsearBanco } from "./cargar-banco";
import type { BusquedaBanco, TipoConsulta } from "./modelo";
import { tipoDe } from "./modelo";
import { cortarPor, resumenNumerico, type ResumenNum } from "./metricas";
import type { AtributosEstructurados } from "@/lib/catalogo-caracteristicas";
import { evaluarMedidas, type EvaluacionMedida } from "./medida-oraculo";
import { bloqueMedidas } from "./metricas-medida";

export * from "./modelo";

/** Banco versionado: pasa por el mismo esquema (`parsearBanco`) que un banco externo (`--banco`). */
export const BANCO: BusquedaBanco[] = parsearBanco(banco, { origen: "embebido" }).casos;

/** Producto tal como lo necesita la evaluación (un recorte de `Product`). */
export interface ProductoBanco {
  /** Para comparar corridas por ids (`--ids`, `--paridad-con`). Ausente en las tuberías viejas. */
  id?: string;
  name: string;
  description?: string;
  sku?: string;
  categoriaPropiaId?: string;
  /** Atributos estructurados del producto (`Product` los trae con `atributosEstructurados: true`); ausente = sin dato. */
  atributosEstructurados?: AtributosEstructurados;
}

/** Lo que devolvió una tubería para una búsqueda. */
export interface ResultadoBanco {
  /** Ausente: la tubería no clasifica intención (fase 1). */
  intencion?: string;
  categoriasDuras: string[];
  /** Categorías blandas en orden de peso (la primera es la "entendida" si no hay duras). */
  categoriasBlandas: string[];
  atributosDuros: string[];
  /** Términos expandidos (sinónimos) del plan. */
  expansiones: string[];
  productos: ProductoBanco[];
  total: number;
  /** Milisegundos de la búsqueda entera (entender + página). */
  ms?: number;
  /** `--jev=cache`: no había plan cacheado y se usó el determinista (sin Jev). */
  sinPlanCacheado?: boolean;
  /** Tubería `motor`: ids de los productos devueltos, en orden (paridad entre corridas). */
  ids?: string[];
  /** Tubería `motor`: la etapa que resolvió la búsqueda (`plan`, `exacta`, `tolerante`…). */
  etapa?: string;
  /**
   * Ids de medida que el plan produjo: dinámicos (`clave:valor`) o, cuando existe equivalente, los del
   * diccionario (`zocalo-e27`, `tension-12v`, `apto-exterior`). Ausente = la tubería no produce medidas
   * (todavía): el `hit` de medidas queda en `null`, no en fallo.
   */
  medidas?: string[];
}

export interface EvaluacionBusqueda {
  q: string;
  diagnostico: boolean;
  /** `null` = la expectativa no aplica (no hay o la tubería no la produce). */
  intencionOk: boolean | null;
  categoriaOk: boolean | null;
  atributosOk: boolean | null;
  top24Ok: boolean | null;
  /** Posición (1-based) del primer producto esperado; `null` si no está o no aplica. */
  posicion: number | null;
  sinResultadosIndebido: boolean;
  /** Puntos obtenidos y posibles (ver `PESOS`). */
  puntos: number;
  posibles: number;
  categoriaEntendida?: string;
  total: number;
  perfil: string;
  /** Tipo de consulta (explícito o derivado, ver `tipoDe`). */
  tipo: TipoConsulta;
  intencionEsperada?: string;
  /** 1/posición del primer esperado (0 si no está); `null` = el caso no tiene expectativa de producto. */
  rr: number | null;
  /** precision@24 proxy, fracción 0..1; `null` = el caso no tiene criterio de relevancia. */
  precision: number | null;
  /** La tubería devolvió 0 resultados (con o sin `nuncaSinResultados`). */
  zero: boolean;
  /** Hits de la consulta (banco real); ausente = sin ponderar. */
  peso?: number;
  /** Latencia de la primera repetición (ms). */
  ms?: number;
  /** Latencias de todas las repeticiones (ms), para p50/p95. */
  muestrasMs?: number[];
  /** Jev grabado sin respuesta para este caso: se excluye de las métricas (lo cuenta la corrida). */
  sinGrabacion?: boolean;
  /** Tubería `motor`: ids de lo devuelto y etapa que resolvió (sólo se escriben en el JSON con `--ids` / aparte). */
  ids?: string[];
  etapa?: string;
  /** Sólo en casos con `medidas`/`sinMedidasDe`: ver `evaluarMedidas`. El puntaje y `PESOS` no la incluyen. */
  medida?: EvaluacionMedida;
}

const normalizar = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ¿El texto tiene alguna palabra que empieza con `prefijo`? (normalizado, sin tildes). */
export function tienePalabra(texto: string, prefijo: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapar(normalizar(prefijo))}`).test(normalizar(texto));
}

/**
 * Pesos del puntaje total. El producto en la primera página pesa doble: es lo
 * que ve el cliente. Una posición entre las 3 primeras suma un punto más.
 */
export const PESOS = { intencion: 1, categoria: 1, atributos: 1, top24: 2, top3: 1, noVacio: 1 } as const;

/** Ids de las categorías aceptables y todas sus descendientes. */
function idsConDescendientes(arbol: { id: string; parentId: string | null; nombre: string }[], nombres: string[]) {
  const ids = new Set(arbol.filter((n) => nombres.includes(n.nombre)).map((n) => n.id));
  let creció = true;
  while (creció) {
    creció = false;
    for (const n of arbol) {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id);
        creció = true;
      }
    }
  }
  return ids;
}

/**
 * `k` = cuántos productos mira la evaluación: 24 (la primera página del catálogo, la de siempre),
 * 8 (autocompletar) o 10 (chat). Los nombres `top24Ok`/`hit24` se conservan por compatibilidad con
 * los JSON congelados: con otra superficie significan "en los primeros K".
 */
export function evaluar(
  b: BusquedaBanco,
  r: ResultadoBanco,
  arbol: { id: string; parentId: string | null; nombre: string }[],
  { k = 24 }: { k?: number } = {},
): EvaluacionBusqueda {
  let puntos = 0;
  let posibles = 0;
  const sumar = (ok: boolean | null, peso: number) => {
    if (ok === null) return;
    posibles += peso;
    if (ok) puntos += peso;
  };

  const intencionOk = b.intencion && r.intencion !== undefined ? r.intencion === b.intencion : null;
  // Sin intención en la tubería (fase 1), la expectativa cuenta como fallada: no la produce.
  sumar(b.intencion ? (intencionOk ?? false) : null, PESOS.intencion);

  const categoriaEntendida = r.categoriasDuras[0] ?? r.categoriasBlandas[0];
  let categoriaOk: boolean | null = null;
  if (b.categoria?.length) {
    categoriaOk = [...r.categoriasDuras, ...r.categoriasBlandas.slice(0, 1)].some((c) => b.categoria!.includes(c));
  } else if (b.sinDuros) {
    categoriaOk = r.categoriasDuras.length === 0;
  }
  sumar(categoriaOk, PESOS.categoria);

  const atributosOk = b.atributosDuros?.length ? b.atributosDuros.every((a) => r.atributosDuros.includes(a)) : null;
  sumar(atributosOk, PESOS.atributos);

  const top = r.productos.slice(0, k);
  const idsCat = b.categoriaEnTop24?.length ? idsConDescendientes(arbol, b.categoriaEnTop24) : null;
  const esperado = (p: ProductoBanco) =>
    (b.debeIncluirEnTop24 ?? []).some((e) => tienePalabra(`${p.name} ${p.description ?? ""} ${p.sku ?? ""}`, e)) ||
    (!!idsCat && !!p.categoriaPropiaId && idsCat.has(p.categoriaPropiaId));
  const conExpectativa = !!b.debeIncluirEnTop24?.length || !!idsCat;
  const indice = conExpectativa ? top.findIndex(esperado) : -1;
  const top24Ok = conExpectativa ? indice >= 0 : null;
  const posicion = indice >= 0 ? indice + 1 : null;
  sumar(top24Ok, PESOS.top24);
  sumar(conExpectativa ? indice >= 0 && indice < 3 : null, PESOS.top3);

  // precision@24 (proxy): relevante = el esperado de arriba o un producto de la categoría propia buscada.
  const idsPropia = b.categoria?.length ? idsConDescendientes(arbol, b.categoria) : null;
  const conCriterioPrecision = conExpectativa || !!idsPropia?.size;
  const relevante = (p: ProductoBanco) =>
    esperado(p) || (!!idsPropia && !!p.categoriaPropiaId && idsPropia.has(p.categoriaPropiaId));
  const precision = conCriterioPrecision ? (top.length ? top.filter(relevante).length / top.length : 0) : null;
  const rr = conExpectativa ? (indice >= 0 ? 1 / (indice + 1) : 0) : null;

  const sinResultadosIndebido = !!b.nuncaSinResultados && r.total === 0;
  sumar(b.nuncaSinResultados ? !sinResultadosIndebido : null, PESOS.noVacio);

  const medida = evaluarMedidas(b, r);

  return {
    q: b.q,
    diagnostico: !!b.diagnostico,
    intencionOk,
    categoriaOk,
    atributosOk,
    top24Ok,
    posicion,
    sinResultadosIndebido,
    puntos,
    posibles,
    categoriaEntendida,
    total: r.total,
    perfil: b.perfil,
    tipo: tipoDe(b),
    ...(b.intencion ? { intencionEsperada: b.intencion } : {}),
    rr,
    precision,
    zero: r.total === 0,
    ...(b.peso !== undefined ? { peso: b.peso } : {}),
    ...(r.ms !== undefined ? { ms: r.ms } : {}),
    ...(medida ? { medida } : {}),
  };
}

export interface Resumen {
  busquedas: number;
  intencion: string;
  categoria: string;
  atributos: string;
  top24: string;
  top3: string;
  posicionMedia: string;
  sinResultadosIndebidos: number;
  puntaje: number;
}

const pct = (ok: number, de: number) => (de ? `${ok}/${de} (${Math.round((100 * ok) / de)}%)` : "n/a");

export function resumir(evs: EvaluacionBusqueda[], conIntencion: boolean, banco: BusquedaBanco[] = BANCO): Resumen {
  const de = (f: (e: EvaluacionBusqueda) => boolean | null) => evs.map(f).filter((x) => x !== null) as boolean[];
  const intencionEsperada = evs.filter((e) => banco.find((b) => b.q === e.q)?.intencion);
  const intencion = conIntencion ? de((e) => e.intencionOk) : [];
  const categoria = de((e) => e.categoriaOk);
  const atributos = de((e) => e.atributosOk);
  const top24 = de((e) => e.top24Ok);
  const top3 = evs.filter((e) => e.top24Ok !== null).map((e) => e.posicion !== null && e.posicion <= 3);
  const posiciones = evs.map((e) => e.posicion).filter((p): p is number => p !== null);
  const puntos = evs.reduce((s, e) => s + e.puntos, 0);
  const posibles = evs.reduce((s, e) => s + e.posibles, 0);
  return {
    busquedas: evs.length,
    intencion: conIntencion ? pct(intencion.filter(Boolean).length, intencion.length) : `n/a (0/${intencionEsperada.length})`,
    categoria: pct(categoria.filter(Boolean).length, categoria.length),
    atributos: pct(atributos.filter(Boolean).length, atributos.length),
    top24: pct(top24.filter(Boolean).length, top24.length),
    top3: pct(top3.filter(Boolean).length, top3.length),
    posicionMedia: posiciones.length ? (posiciones.reduce((s, p) => s + p, 0) / posiciones.length).toFixed(1) : "n/a",
    sinResultadosIndebidos: evs.filter((e) => e.sinResultadosIndebido).length,
    puntaje: posibles ? Math.round((1000 * puntos) / posibles) / 10 : 0,
  };
}

const marca = (v: boolean | null) => (v === null ? "·" : v ? "✓" : "✗");

/** Reporte en texto: una línea por búsqueda y el resumen (total y diagnóstico). Sin nombres de productos. */
export function reporte(titulo: string, evs: EvaluacionBusqueda[], conIntencion: boolean, k = 24): string {
  const lineas = [`# ${titulo}`, "", "int cat atr top pos  total  consulta → categoría entendida"];
  for (const e of evs) {
    lineas.push(
      [
        ` ${marca(conIntencion ? e.intencionOk : null)} `,
        ` ${marca(e.categoriaOk)} `,
        ` ${marca(e.atributosOk)} `,
        ` ${marca(e.top24Ok)} `,
        String(e.posicion ?? "-").padStart(3),
        String(e.total).padStart(6),
        ` ${e.diagnostico ? "*" : " "}${e.q} → ${e.categoriaEntendida ?? "-"}${e.sinResultadosIndebido ? "  [SIN RESULTADOS]" : ""}${e.medida?.falsoPositivo ? "  [MEDIDA INDEBIDA]" : ""}`,
      ].join(" "),
    );
  }
  const fila = (nombre: string, r: Resumen) =>
    `${nombre.padEnd(12)} | ${r.busquedas} | ${r.intencion} | ${r.categoria} | ${r.atributos} | ${r.top24} | ${r.top3} | ${r.posicionMedia} | ${r.sinResultadosIndebidos} | ${r.puntaje}`;
  lineas.push(
    "",
    "(* = diagnóstico 2026-09-30)",
    "",
    `conjunto     | n | intención | categoría | atributos | top ${k} | top 3 | pos. media | sin resultados indebidos | puntaje %`,
    fila("total", resumir(evs, conIntencion)),
    fila("diagnóstico", resumir(evs.filter((e) => e.diagnostico), conIntencion)),
  );
  return lineas.join("\n");
}

const pctNum = (x: number | null) => (x === null ? "n/a" : `${(100 * x).toFixed(1)}%`);
const dec = (x: number | null, d: number) => (x === null ? "n/a" : x.toFixed(d));

const ENCABEZADO_AMPLIADO =
  "n | hit@24 | hit@3 | MRR | precision@24 | zero total | zero indebido | p50 ms | p95 ms";

/** El texto de las métricas con el K de la superficie (24 = el de siempre, sin cambios). */
const conK = (texto: string, k: number) => (k === 24 ? texto : texto.replaceAll("@24", `@${k}`));

function filaAmpliada(nombre: string, r: ResumenNum): string {
  return [
    nombre.padEnd(18),
    r.n,
    pctNum(r.hit24),
    pctNum(r.hit3),
    dec(r.mrr, 3),
    pctNum(r.precision24),
    `${r.zeroTotal} (${pctNum(r.n ? r.zeroRate : null)})`,
    `${r.zeroIndebido} (${pctNum(r.n ? r.zeroIndebidoRate : null)})`,
    r.latencia.n ? r.latencia.p50 : "n/a",
    r.latencia.n ? r.latencia.p95 : "n/a",
  ].join(" | ");
}

/**
 * Bloque adicional del reporte (línea base): hit@24, hit@3, MRR, precision@24
 * (proxy), zero-result y latencia, en total y por perfil / intención / tipo.
 * Va DEBAJO de `reporte()`, que no cambia (la tabla y el resumen de siempre).
 * Sólo agregados: sin consultas ni nombres de productos.
 */
export function reporteAmpliado(evs: EvaluacionBusqueda[], conIntencion: boolean, k = 24): string {
  const total = resumenNumerico(evs, conIntencion);
  const encabezado = conK(ENCABEZADO_AMPLIADO, k);
  const lineas = [
    "## Métricas ampliadas",
    conK("(precision@24 es un proxy: esperados o de la categoría buscada sobre los productos devueltos; MRR 0..1)", k),
    "",
    `corte              | ${encabezado}`,
    filaAmpliada("total", total),
  ];
  if (total.precisionExcluidos) lineas.push("", conK(`precision@24: ${total.precisionExcluidos} caso(s) sin criterio de relevancia, excluidos del promedio.`, k));
  if (total.ponderado) {
    lineas.push(
      "",
      conK(`ponderado por peso (hits): hit@24 ${pctNum(total.ponderado.hit24)} | MRR ${dec(total.ponderado.mrr, 3)} | zero ${pctNum(total.ponderado.zeroRate)}`, k),
    );
  }
  const cortes: [string, "perfil" | "intencionEsperada" | "tipo"][] = [
    ["por perfil", "perfil"],
    ["por intención esperada", "intencionEsperada"],
    ["por tipo de consulta", "tipo"],
  ];
  for (const [titulo, clave] of cortes) {
    lineas.push("", `### ${titulo}`, `corte              | ${encabezado}`);
    for (const [valor, r] of Object.entries(cortarPor(evs, clave, conIntencion))) lineas.push(filaAmpliada(valor, r));
  }
  const medidas = bloqueMedidas(evs);
  if (medidas.length) lineas.push("", ...medidas);
  return lineas.join("\n");
}
