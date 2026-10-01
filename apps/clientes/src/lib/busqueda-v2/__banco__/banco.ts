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

export type IntencionBanco = "codigo" | "producto" | "necesidad" | "pregunta";

export interface BusquedaBanco {
  q: string;
  perfil: "particular" | "profesional" | "codigo";
  /** Una de las 15 búsquedas del diagnóstico del 2026-09-30. */
  diagnostico?: boolean;
  intencion?: IntencionBanco;
  /** Nombres de categoría aceptables: alcanza con que la entendida sea una. */
  categoria?: string[];
  /** Atributos que el usuario pidió explícitamente (deberían quedar duros). */
  atributosDuros?: string[];
  /** Términos del catálogo que deberían aparecer como expansión (sinónimos). */
  expande?: string[];
  /** Comienzo de palabra que algún producto de la primera página tiene que tener. */
  debeIncluirEnTop24?: string[];
  /** Alguna categoría (o descendiente) que algún producto de la primera página tiene que tener. */
  categoriaEnTop24?: string[];
  /** Ninguna categoría dura (preguntas y códigos). */
  sinDuros?: boolean;
  nuncaSinResultados?: boolean;
}

export const BANCO: BusquedaBanco[] = (banco as { busquedas: BusquedaBanco[] }).busquedas;

/** Producto tal como lo necesita la evaluación (un recorte de `Product`). */
export interface ProductoBanco {
  name: string;
  description?: string;
  sku?: string;
  categoriaPropiaId?: string;
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

export function evaluar(
  b: BusquedaBanco,
  r: ResultadoBanco,
  arbol: { id: string; parentId: string | null; nombre: string }[],
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

  const top = r.productos.slice(0, 24);
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

  const sinResultadosIndebido = !!b.nuncaSinResultados && r.total === 0;
  sumar(b.nuncaSinResultados ? !sinResultadosIndebido : null, PESOS.noVacio);

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
export function reporte(titulo: string, evs: EvaluacionBusqueda[], conIntencion: boolean): string {
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
        ` ${e.diagnostico ? "*" : " "}${e.q} → ${e.categoriaEntendida ?? "-"}${e.sinResultadosIndebido ? "  [SIN RESULTADOS]" : ""}`,
      ].join(" "),
    );
  }
  const fila = (nombre: string, r: Resumen) =>
    `${nombre.padEnd(12)} | ${r.busquedas} | ${r.intencion} | ${r.categoria} | ${r.atributos} | ${r.top24} | ${r.top3} | ${r.posicionMedia} | ${r.sinResultadosIndebidos} | ${r.puntaje}`;
  lineas.push(
    "",
    "(* = diagnóstico 2026-09-30)",
    "",
    "conjunto     | n | intención | categoría | atributos | top 24 | top 3 | pos. media | sin resultados indebidos | puntaje %",
    fila("total", resumir(evs, conIntencion)),
    fila("diagnóstico", resumir(evs.filter((e) => e.diagnostico), conIntencion)),
  );
  return lineas.join("\n");
}
