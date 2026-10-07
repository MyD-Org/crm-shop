/**
 * Orden "Destacados" del catálogo sin búsqueda: la parte pura (sin DB), que `ordenDe` de
 * catalog.ts pasa al SQL como parámetros (change `catalogo-orden-destacados`, rebanada B).
 *
 * - Qué es un accesorio: por la categoría (propia o de Alegra, o una ancestra) o por la PRIMERA
 *   palabra del nombre exhibido. En el rubro el nombre arranca por el tipo de producto: "Soporte
 *   para panel" es un accesorio, "Panel 60x60 con soporte" no. La lista es corta a propósito y sin
 *   palabras que también nombran productos principales (fuente, driver, transformador, riel,
 *   perfil, caja, módulo…): un accesorio sólo va más abajo, nunca se excluye, y un falso positivo
 *   se arregla con el dato (nombre o categoría), no ampliando la regla.
 * - En qué orden van las subcategorías al intercalarse: el del árbol propio (`orden` del admin,
 *   después nombre), en lectura de arriba a abajo.
 *
 * Los patrones son strings de regex PORTABLES: el mismo texto se usa con `new RegExp` acá y con
 * `~` en Postgres (ARE), sobre texto ya en minúsculas y sin tildes.
 */

/** Primeras palabras que hacen accesorio a un producto (singular, sin tildes). */
export const PALABRAS_ACCESORIO = [
  "accesorio",
  "acople",
  "acoplador",
  "adaptador",
  "amplificador",
  "conector",
  "empalme",
  "union",
  "tapa",
  "tapon",
  "soporte",
  "grampa",
  "clip",
  "terminal",
  "repuesto",
] as const;

/**
 * Nombre (minúsculas, sin tildes, sin espacios al borde) que arranca por una palabra de
 * `PALABRAS_ACCESORIO` (o su plural) o por "kit de fijación/montaje/instalación" o "control
 * remoto". La palabra tiene que terminar ahí: "tapaluz" no es "tapa".
 */
export const PATRON_NOMBRE_ACCESORIO =
  `^(?:(?:${PALABRAS_ACCESORIO.join("|")})(?:s|es)?` +
  `|kits? de (?:fijacion|montaje|instalacion)` +
  `|control(?:es)? remotos?)(?:[^a-z0-9]|$)`;

/**
 * Nombre de categoría (minúsculas, sin tildes, sin espacios al borde) de accesorios o repuestos:
 * tiene que ARRANCAR así ("Accesorios", "Repuestos y accesorios", "Accesorios eléctricos"). Una
 * categoría que sólo los menciona al final ("Llaves, tomas y accesorios") vende sobre todo
 * productos principales: no se marca.
 */
export const PATRON_CATEGORIA_ACCESORIO = `^(?:accesorio|repuesto)s?(?:[^a-z]|$)`;

const RE_NOMBRE = new RegExp(PATRON_NOMBRE_ACCESORIO);
const RE_CATEGORIA = new RegExp(PATRON_CATEGORIA_ACCESORIO);

/** Minúsculas y sin tildes, como `"shop".immutable_unaccent(lower(…))` en SQL. */
export function normalizarNombre(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
}

/** ¿El nombre exhibido del producto es el de un accesorio? (ver `PATRON_NOMBRE_ACCESORIO`). */
export function esNombreAccesorio(nombre: string): boolean {
  return RE_NOMBRE.test(normalizarNombre(nombre));
}

/** ¿El nombre de una categoría es de accesorios o repuestos? */
export function esCategoriaAccesorio(nombre: string): boolean {
  return RE_CATEGORIA.test(normalizarNombre(nombre));
}

/** Lo que hace falta de una categoría propia (lo que devuelve `getArbolCategorias`). */
export interface CategoriaArbol {
  id: string;
  parentId: string | null;
  nombre: string;
  orden: number;
}

/**
 * Ids de las categorías de accesorios: las que se llaman así y TODA su descendencia
 * ("Iluminación > Accesorios > Soportes" es accesorio aunque "Soportes" no lo diga).
 */
export function idsCategoriasAccesorio(arbol: CategoriaArbol[]): string[] {
  const porId = new Map(arbol.map((n) => [n.id, n]));
  const ids: string[] = [];
  for (const n of arbol) {
    const vistos = new Set<string>();
    for (let a: CategoriaArbol | undefined = n; a && !vistos.has(a.id); a = a.parentId ? porId.get(a.parentId) : undefined) {
      vistos.add(a.id);
      if (esCategoriaAccesorio(a.nombre)) {
        ids.push(n.id);
        break;
      }
    }
  }
  return ids;
}

/**
 * Ids del árbol en orden de lectura (raíces primero, cada rama entera antes de la siguiente;
 * hermanas por `orden` y después por nombre, como el panel de categorías). Una categoría que
 * cuelga de otra que no está en el árbol (inactiva) no aparece: queda al final en el SQL.
 */
export function preordenArbol(arbol: CategoriaArbol[]): string[] {
  const hijas = new Map<string | null, CategoriaArbol[]>();
  for (const n of arbol) {
    const lista = hijas.get(n.parentId) ?? [];
    lista.push(n);
    hijas.set(n.parentId, lista);
  }
  for (const lista of hijas.values()) {
    lista.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  }
  const salida: string[] = [];
  const vistos = new Set<string>();
  const recorrer = (parentId: string | null) => {
    for (const n of hijas.get(parentId) ?? []) {
      if (vistos.has(n.id)) continue;
      vistos.add(n.id);
      salida.push(n.id);
      recorrer(n.id);
    }
  };
  recorrer(null);
  return salida;
}

/**
 * Lista de uuids como literal de arreglo de Postgres (`{a,b}`), para pasarla como UN parámetro
 * (`${literal}::uuid[]`). Sólo ids con forma de uuid: nada más entra al literal.
 */
export function literalUuids(ids: string[]): string {
  const validos = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  return `{${validos.join(",")}}`;
}
