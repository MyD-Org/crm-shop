/**
 * De una interpretación a URLs del catálogo. Módulo puro: todo pasa por
 * `lib/catalogo-url.ts`, que descarta lo inválido (un atributo desconocido no
 * llega a la URL). Ni Jev ni el agente tocan la UI: proponen un estado y el
 * Shop lo valida y navega.
 */
import { atributoPorId, nombreAtributo } from "../catalogo-atributos";
import {
  IA_DESACTIVADA,
  estadoConCambios,
  hrefCatalogo,
  type EstadoCatalogo,
} from "../catalogo-url";
import { formatRubro } from "../formato-rubro";
import type { FiltrosInterpretados, Interpretacion } from "./tipos";

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/**
 * URL con la interpretación aplicada: suma sus categorías y atributos a los
 * filtros vigentes, reemplaza la búsqueda por el texto residual (o la quita) y
 * deja `ia=<consulta original>` (la franja "Entendimos" y el freno contra
 * volver a interpretar).
 */
export function hrefInterpretada(estado: EstadoCatalogo, i: Pick<Interpretacion, "consulta" | "aplicar">): string {
  return hrefCatalogo(
    estadoConCambios(estado, {
      query: i.aplicar.q,
      categorias: union(estado.categorias, i.aplicar.categorias),
      atributos: union(estado.atributos, i.aplicar.atributos),
      ia: i.consulta,
    }),
  );
}

/**
 * "Ver resultados de «consulta» tal cual": la búsqueda original, sin los
 * filtros que salieron de interpretarla y con `ia=0` (no se vuelve a
 * interpretar). Conserva marcas, precio, stock y vista.
 */
export function hrefTalCual(estado: EstadoCatalogo, consulta: string): string {
  return hrefCatalogo(
    estadoConCambios(estado, { query: consulta, categorias: [], atributos: [], ia: IA_DESACTIVADA, orden: "relevancia" }),
  );
}

/** Un filtro propuesto como chip que se toca para aplicarlo (un link). */
export interface ChipSugerido {
  clave: string;
  tipo: "categoria" | "atributo";
  valor: string;
  etiqueta: string;
  href: string;
}

/**
 * Cómo aplica un chip su filtro:
 * - `sumar` (franja con resultados): suma el filtro y conserva la búsqueda; el
 *   conjunto se achica, no cambia.
 * - `reemplazar` (alternativas de "sin resultados"): quita la búsqueda (con
 *   ella no había nada) y el filtro reemplaza a los de su tipo; un atributo,
 *   sólo a los de su mismo grupo ("Luz fría" en lugar de "Luz cálida").
 */
export type ModoChip = "sumar" | "reemplazar";

function cambiosDe(
  estado: EstadoCatalogo,
  tipo: ChipSugerido["tipo"],
  valor: string,
  modo: ModoChip,
): Partial<EstadoCatalogo> {
  if (modo === "sumar") {
    return tipo === "categoria"
      ? { categorias: [...estado.categorias, valor] }
      : { atributos: [...estado.atributos, valor] };
  }
  const base = { query: undefined, ia: undefined };
  if (tipo === "categoria") return { ...base, categorias: [valor] };
  const grupo = atributoPorId(valor)?.grupo;
  return { ...base, atributos: [...estado.atributos.filter((a) => atributoPorId(a)?.grupo !== grupo), valor] };
}

/**
 * Chips de una interpretación sobre el estado vigente: en el orden de
 * `filtros` (lo que se aplicaría antes que lo sugerido), sin repetidos ni los
 * que ya están puestos.
 */
export function chipsSugeridos(
  estado: EstadoCatalogo,
  filtros: FiltrosInterpretados[],
  modo: ModoChip = "sumar",
): ChipSugerido[] {
  const chips: ChipSugerido[] = [];
  const vistos = new Set<string>();
  for (const f of filtros) {
    for (const c of f.categorias) {
      const clave = `categoria:${c}`;
      if (vistos.has(clave) || estado.categorias.includes(c)) continue;
      vistos.add(clave);
      chips.push({
        clave,
        tipo: "categoria",
        valor: c,
        etiqueta: formatRubro(c),
        href: hrefCatalogo(estadoConCambios(estado, cambiosDe(estado, "categoria", c, modo))),
      });
    }
    for (const a of f.atributos) {
      const clave = `atributo:${a}`;
      if (vistos.has(clave) || estado.atributos.includes(a)) continue;
      vistos.add(clave);
      chips.push({
        clave,
        tipo: "atributo",
        valor: a,
        etiqueta: nombreAtributo(a),
        href: hrefCatalogo(estadoConCambios(estado, cambiosDe(estado, "atributo", a, modo))),
      });
    }
  }
  return chips;
}
