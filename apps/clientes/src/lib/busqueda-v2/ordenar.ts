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
 *   más): lo que la búsqueda clásica encontraba sigue arriba;
 * - frase: el nombre contiene los términos originales significativos en orden y
 *   juntos ("lampara de escritorio") +10: un producto que se llama como se lo
 *   pidió va antes que uno que sólo comparte alguna palabra o la categoría;
 * - categoría blanda +6 × peso; atributo blando +3 × peso;
 * - medida DISCRETA de confianza alta (polos, corriente, sensibilidad, zócalo; peso 1): el que la cumple +1000, el
 *   que tiene el dato de OTRO valor -1000 y el que no tiene dato 0. Es un escalón por encima de todo lo demás: el
 *   que cumple va siempre antes que el que contradice (los sin dato, en el medio). Sólo ordena, nunca excluye;
 * - con stock +1.
 */
import { sql, type SQL } from "drizzle-orm";
import { normalizarConsulta } from "../busqueda-inteligente/normalizar";
import { PESO_ORDEN_ESTRICTO, esMedidaDiscreta } from "../catalogo-atributos-medida";
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
  /** Escalón del orden estricto de las medidas discretas: mayor que toda la suma de las demás partes, con holgura. */
  medidaDiscreta: 1000,
} as const;

/** Entero literal (constante de código): como parámetro, el CASE no sabría su tipo. */
const n = (x: number) => sql.raw(String(Math.trunc(x)));
/** Puntos con decimales (peso × puntos), como parámetro numérico. */
const decimal = (x: number) => sql`${Math.round(x * 1000) / 1000}::numeric`;
const si = (condicion: SQL, puntos: SQL) => sql`(case when ${condicion} then ${puntos} else 0 end)`;

export function puntajeBusqueda(plan: CriterioPlan, p: PiezasBusqueda): SQL {
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
  if (originales.length) {
    partes.push(si(sql`${p.nombre} ~ ${patronInicio(originales[0])}`, n(PUNTOS.prefijo)));
  }
  if (originales.length >= 2) {
    partes.push(si(sql.join(originales.map((t) => sql`${p.texto} ~ ${patronTermino(t)}`), sql` and `), n(PUNTOS.todos)));
  }
  const frase = patronFrase(originales);
  if (frase) partes.push(si(sql`${p.nombre} ~ ${frase}`, n(PUNTOS.frase)));
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
  partes.push(si(p.conStock, n(PUNTOS.stock)));
  return sql.join(partes, sql` + `);
}
