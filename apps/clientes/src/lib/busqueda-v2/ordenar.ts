/**
 * ORDENAR (spec búsqueda v2): el puntaje SQL del orden `relevancia` cuando hay
 * plan. Extiende el de la búsqueda clásica (catalog.ts, `relevanciaSql`).
 * Módulo puro.
 *
 * Por término, DÓNDE aparece (al comienzo de una palabra): nombre 4, código 3,
 * marca o categoría de Alegra 2, otro lado (descripción) 1, nada 0 (en la v2
 * los términos no filtran: un producto puede no tener alguno). Cada término
 * multiplica por su peso: 1 los originales, 0,7 las expansiones, menos el
 * contexto y las medidas. Encima:
 * - código exacto +20 (quien pega un código quiere ESE producto);
 * - nombre que empieza con el primer término original +2;
 * - todos los términos originales significativos presentes +3 (con dos o
 *   más): lo que la búsqueda clásica encontraba sigue arriba. Un original
 *   cumple también por una de SUS expansiones del plan ("foco smart": un
 *   "bulbo smart" tiene los dos) o por la categoría filtrada que lo nombra (en
 *   "Lámparas", todo es un foco: basta con "smart");
 * - frase: el nombre contiene los términos originales significativos en orden y
 *   juntos ("lampara de escritorio") +10: un producto que se llama como se lo
 *   pidió va antes que uno que sólo comparte alguna palabra o la categoría. Con
 *   un solo original y sin medida en la consulta, el nombre que lo contiene (o
 *   a una de sus expansiones): "escritorio luz" pone las lámparas de
 *   escritorio antes que los bulbos de la categoría blanda;
 * - categoría blanda +6 × peso; atributo blando +3 × peso;
 * - medida DISCRETA de confianza alta (polos, corriente, sensibilidad, zócalo; peso 1): el que la cumple +1000, el
 *   que tiene el dato de OTRO valor -1000 y el que no tiene dato 0. Es un escalón por encima de todo lo demás: el
 *   que cumple va siempre antes que el que contradice (los sin dato, en el medio). Sólo ordena, nunca excluye;
 * - consulta de la casa (patio, living, cocina…, sin galpón, cancha ni
 *   industrial): lo industrial o de más de 200 W -2. Señal blanda, nunca
 *   excluye: en el patio de una casa se pone un reflector de 20–50 W, no uno de
 *   240 W;
 * - con stock +1.
 *
 * Los empates los desempata catalog.ts (`ordenDe`): más stock primero, después
 * el nombre.
 */
import { sql, type SQL } from "drizzle-orm";
import { normalizarConsulta } from "../busqueda-inteligente/normalizar";
import { raizPlural } from "../catalogo-busqueda";
import { PESO_ORDEN_ESTRICTO, esMedidaDiscreta } from "../catalogo-atributos-medida";
import { expansiones } from "./entender/sinonimos";
import { patronFrase, patronInicio, patronTermino, type CriterioPlan, type PiezasBusqueda } from "./piezas";

export const PUNTOS = {
  nombre: 4,
  codigo: 3,
  marcaCategoria: 2,
  otro: 1,
  codigoExacto: 20,
  prefijo: 2,
  todos: 3,
  frase: 10,
  categoria: 6,
  atributo: 3,
  stock: 1,
  /** Lo industrial o de alta potencia en una consulta de la casa (se resta). */
  industrialEnCasa: 2,
  /** Escalón del orden estricto de las medidas discretas: mayor que toda la suma de las demás partes, con holgura. */
  medidaDiscreta: 1000,
} as const;

/** Entero literal (constante de código): como parámetro, el CASE no sabría su tipo. */
const n = (x: number) => sql.raw(String(Math.trunc(x)));
/** Puntos con decimales (peso × puntos), como parámetro numérico. */
const decimal = (x: number) => sql`${Math.round(x * 1000) / 1000}::numeric`;
const si = (condicion: SQL, puntos: SQL) => sql`(case when ${condicion} then ${puntos} else 0 end)`;

/** Lugares de una casa: quien los nombra busca uso doméstico. En singular normalizado. */
const LUGARES_DE_CASA = new Set([
  "patio", "jardin", "living", "comedor", "cocina", "bano", "dormitorio", "habitacion", "cuarto", "pieza",
  "balcon", "terraza", "quincho", "parrilla", "casa", "departamento", "pasillo", "escalera", "entrada",
  "garage", "garaje", "cochera", "pileta", "piscina", "galeria", "vereda", "frente",
]);
/** Uso industrial o de gran superficie: anula la señal doméstica aunque haya un lugar de la casa. */
const CONTEXTO_INDUSTRIAL = new Set([
  "galpon", "deposito", "cancha", "industrial", "industria", "fabrica", "nave", "estadio", "playon", "obra",
  "padel", "futbol", "tenis", "estacionamiento",
]);
/** Desde esta potencia (W, exclusive) un producto no es de uso doméstico. */
export const POTENCIA_NO_DOMESTICA_W = 200;

/** ¿La consulta habla de un lugar de la casa sin ningún contexto industrial? */
export function esConsultaDeCasa(consulta: string): boolean {
  const tokens = (normalizarConsulta(consulta) ?? "").split(" ").map(raizPlural);
  return tokens.some((t) => LUGARES_DE_CASA.has(t)) && !tokens.some((t) => CONTEXTO_INDUSTRIAL.has(t));
}

/**
 * Por cada término original, él y sus expansiones (sinónimos) que el plan trae: cualquiera de ellos
 * cumple por el original ("foco" → lampara, bulbo).
 */
export function gruposDeOriginales(originales: readonly string[], terminos: CriterioPlan["blandos"]["terminos"]): string[][] {
  const expandidos = new Set(terminos.filter((t) => t.peso < 1).map((t) => t.texto));
  return originales.map((o) => [o, ...expansiones([raizPlural(o)], o).filter((e) => expandidos.has(e))]);
}

const algunoEn = (campo: SQL, grupo: readonly string[]) =>
  grupo.length === 1 ? sql`${campo} ~ ${patronTermino(grupo[0])}` : sql`(${sql.join(grupo.map((t) => sql`${campo} ~ ${patronTermino(t)}`), sql` or `)})`;

/**
 * ¿El grupo ya lo resuelve una categoría filtrada (de la URL)? Con "foco smart" filtrado en
 * "Lámparas", todo es un foco: lo que distingue es "smart".
 */
const cubiertoPorCategoria = (grupo: readonly string[], categorias: readonly string[]) =>
  categorias.some((c) => {
    const nombre = normalizarConsulta(c) ?? "";
    return grupo.some((t) => new RegExp(patronTermino(t)).test(nombre));
  });

export interface OpcionesPuntaje {
  /** Categorías filtradas (duras del plan o elegidas): todos sus productos ya cumplen lo que nombran. */
  categoriasFiltro?: readonly string[];
}

export function puntajeBusqueda(plan: CriterioPlan, p: PiezasBusqueda, opciones: OpcionesPuntaje = {}): SQL {
  const partes: SQL[] = [];
  for (const t of plan.blandos.terminos) {
    const patron = patronTermino(t.texto);
    partes.push(
      sql`${decimal(t.peso)} * (case when ${p.nombre} ~ ${patron} then ${n(PUNTOS.nombre)} when ${p.codigo} ~ ${patron} then ${n(PUNTOS.codigo)} when ${p.marcaCategoria} ~ ${patron} then ${n(PUNTOS.marcaCategoria)} when ${p.texto} ~ ${patron} then ${n(PUNTOS.otro)} else 0 end)`,
    );
  }
  const consulta = normalizarConsulta(plan.consulta);
  if (consulta) partes.push(si(sql`${p.codigo} = ${consulta}`, n(PUNTOS.codigoExacto)));
  const originales = plan.blandos.terminos.filter((t) => t.peso >= 1).map((t) => t.texto);
  const grupos = gruposDeOriginales(originales, plan.blandos.terminos);
  if (originales.length) {
    partes.push(si(sql`${p.nombre} ~ ${patronInicio(originales[0])}`, n(PUNTOS.prefijo)));
  }
  const porCumplir = grupos.filter((g) => !cubiertoPorCategoria(g, opciones.categoriasFiltro ?? []));
  if (originales.length >= 2 && porCumplir.length) {
    partes.push(si(sql.join(porCumplir.map((g) => algunoEn(p.texto, g)), sql` and `), n(PUNTOS.todos)));
  }
  const frase = patronFrase(originales);
  if (frase) partes.push(si(sql`${p.nombre} ~ ${frase}`, n(PUNTOS.frase)));
  // Con una medida en la consulta ("hasta 50w"), la que decide es la medida: la palabra suelta puede no
  // ser el producto ("hasta" en "conector de hasta 4 mm²").
  else if (grupos.length === 1 && !plan.blandos.terminos.some((t) => /\d/.test(t.texto))) {
    partes.push(si(algunoEn(p.nombre, grupos[0]), n(PUNTOS.frase)));
  }
  for (const c of plan.blandos.categorias) {
    partes.push(si(p.enCategorias([c.nombre]), decimal(PUNTOS.categoria * c.peso)));
  }
  for (const a of plan.blandos.atributos) {
    const cumple = p.cumpleAtributo(a.id);
    if (cumple) partes.push(si(cumple, decimal(PUNTOS.atributo * a.peso)));
    // Orden estricto: contradecir (dato de otro valor) manda sobre cumplir por el nombre.
    if (cumple && p.contradiceAtributo && a.peso >= PESO_ORDEN_ESTRICTO && esMedidaDiscreta(a.id)) {
      const contradice = p.contradiceAtributo(a.id);
      if (contradice) partes.push(sql`(case when ${contradice} then -${n(PUNTOS.medidaDiscreta)} when ${cumple} then ${n(PUNTOS.medidaDiscreta)} else 0 end)`);
    }
  }
  if (esConsultaDeCasa(plan.consulta)) {
    const potente = p.potencia ? sql` or coalesce(${p.potencia}, 0) > ${n(POTENCIA_NO_DOMESTICA_W)}` : sql``;
    partes.push(sql`-${si(sql`(${p.nombre} ~ ${patronTermino("industrial")}${potente})`, n(PUNTOS.industrialEnCasa))}`);
  }
  partes.push(si(p.conStock, n(PUNTOS.stock)));
  return sql.join(partes, sql` + `);
}
