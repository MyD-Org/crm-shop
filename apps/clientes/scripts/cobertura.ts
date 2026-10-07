/**
 * Cobertura de atributos técnicos del catálogo (lógica PURA, sin DB ni fs):
 * cuántos productos con stock tienen cada una de las 21 claves de
 * `catalog_atributos`, por categoría, y cuáles de esas claves usa hoy la
 * búsqueda. Sólo descriptivo: no decide umbrales. Lo consume el CLI
 * `scripts/cobertura-atributos.ts` (`npm run busqueda:cobertura`).
 *
 * Reglas:
 * - Universo = mismas definiciones del Shop que `__banco__/universo.ts`:
 *   `publicados` (activo + overlay visible + precio) o `activos`, siempre
 *   restringido a los que tienen stock disponible. Es el denominador.
 * - Todo se cuenta por producto DISTINTO (nunca por fila).
 * - Las 25 claves vienen de `CLAVES_ESTRUCTURADAS` (única fuente de verdad del
 *   Shop, cruzada con el fixture compartido con el CRM en los tests).
 * - Sin nombres de producto ni ids en el resultado: sólo categorías, claves,
 *   valores de atributo y conteos (apto para pegar en un PR).
 */
import { ATRIBUTOS } from "@/lib/catalogo-atributos";
import { CLAVES_ESTRUCTURADAS, TIPO, type ClaveEstructurada } from "@/lib/catalogo-caracteristicas";
import { esPublicado, resumirUniverso, type FilaUniverso, type ResumenUniverso } from "@/lib/busqueda-v2/__banco__/universo";

export type UniversoCobertura = "publicados" | "activos";

/** Fila de `public.catalog_atributos` tal como la ve el Shop (sin `fuente`: no está concedida a shop_app). */
export interface FilaAtributo {
  alegraId: string;
  clave: string;
  /** `numeric` de Postgres: llega como texto. */
  valorNum: string | null;
  valorTexto: string | null;
}

export interface NodoCobertura {
  id: string;
  parentId: string | null;
  nombre: string;
  orden: number;
}

export interface OpcionesCobertura {
  universo: UniversoCobertura;
  /** Por defecto las 25 de `CLAVES_ESTRUCTURADAS`. */
  claves?: readonly string[];
  /** Por defecto `clavesUsadasHoy()`. */
  usadasHoy?: ReadonlySet<string>;
}

export interface CeldaClave {
  n: number;
  /** 0..100 con un decimal; 0 si el grupo no tiene productos. */
  pct: number;
}

export interface GrupoCobertura {
  /** `null` en los grupos especiales (sin categoría, inactiva o desconocida). */
  id: string | null;
  nombre: string;
  /** Productos del universo (con stock) del grupo. */
  productos: number;
  /** Productos del grupo sin ninguna fila de una clave conocida. */
  sinAtributos: number;
  claves: Record<string, CeldaClave>;
}

export interface FilaClave {
  clave: string;
  tipo: "num" | "texto";
  usadaHoy: boolean;
  n: number;
  pct: number;
}

export interface DistribucionClave {
  tipo: "num" | "texto";
  /** Productos del universo con valor para la clave. */
  n: number;
  distintos: number;
  /** Los 10 valores más frecuentes (empate: por valor). */
  top: { valor: string; n: number }[];
  /** Sólo claves numéricas con al menos un valor. */
  num?: { min: number; mediana: number; max: number };
}

export interface Cobertura {
  universo: UniversoCobertura;
  /** Conteos del universo completo del tenant (activos, publicados, con stock…). */
  resumen: ResumenUniverso;
  claves: string[];
  global: GrupoCobertura;
  /** Por categoría raíz: suma lo asignado a ella y a todo lo que cuelga de ella. */
  raices: GrupoCobertura[];
  /** Por categoría asignada directamente al producto (la "hoja" del CRM). Sólo las que tienen productos. */
  categorias: GrupoCobertura[];
  sinCategoria: GrupoCobertura;
  /** Categoría que no está en el árbol activo (inactiva, borrada o colgada de una inactiva). */
  inactivas: GrupoCobertura;
  porClave: FilaClave[];
  distribucion: Record<string, DistribucionClave>;
  /** Filas de atributos del universo con una clave que el Shop no conoce (señal de deriva con el CRM). */
  clavesDesconocidas: number;
}

/**
 * Claves que la búsqueda usa HOY para filtrar o rankear:
 * - las de los criterios estructurados del diccionario `ATRIBUTOS` (tono, ip, zócalo, tensión);
 * - `potencia_w`, que filtra (`?potencia_min/max`) y ordena fuera del diccionario.
 *
 * `CLAVES_FILTRO_DIRECTO` es la única parte escrita a mano; un test lee `src/lib/catalog.ts` y falla
 * si el catálogo empieza a consultar otra clave por nombre sin que esté acá.
 */
export const CLAVES_FILTRO_DIRECTO: readonly ClaveEstructurada[] = ["potencia_w"];

export function clavesUsadasHoy(): ReadonlySet<ClaveEstructurada> {
  const set = new Set<ClaveEstructurada>(CLAVES_FILTRO_DIRECTO);
  for (const a of ATRIBUTOS) if (a.estructurado) set.add(a.estructurado.clave);
  return set;
}

const redondear1 = (x: number): number => Math.round(x * 10) / 10;
const porcentaje = (n: number, total: number): number => (total > 0 ? redondear1((n / total) * 100) : 0);

/** Raíz de cada categoría del árbol activo (una sola pasada); `null` si la cadena se corta o es un ciclo. */
function resolverRaices(arbol: readonly NodoCobertura[]): Map<string, string | null> {
  const porId = new Map(arbol.map((n) => [n.id, n]));
  const raices = new Map<string, string | null>();
  for (const nodo of arbol) {
    const visitados = new Set<string>();
    let actual: NodoCobertura | undefined = nodo;
    let raiz: string | null = null;
    while (actual && !visitados.has(actual.id)) {
      visitados.add(actual.id);
      if (actual.parentId === null) {
        raiz = actual.id;
        break;
      }
      actual = porId.get(actual.parentId);
    }
    raices.set(nodo.id, raiz);
  }
  return raices;
}

const tipoDe = (clave: string): "num" | "texto" => (TIPO as Record<string, "num" | "texto">)[clave] ?? "texto";

function mediana(ordenados: readonly number[]): number {
  const m = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1 ? ordenados[m] : (ordenados[m - 1] + ordenados[m]) / 2;
}

function distribuir(clave: string, filas: readonly FilaAtributo[]): DistribucionClave {
  const tipo = tipoDe(clave);
  const conteo = new Map<string, number>();
  const numeros: number[] = [];
  for (const f of filas) {
    let valor: string | null = null;
    if (tipo === "num") {
      const n = f.valorNum === null ? NaN : Number(f.valorNum);
      if (Number.isFinite(n)) {
        numeros.push(n);
        valor = String(n);
      }
    } else if (f.valorTexto !== null && f.valorTexto.trim() !== "") {
      valor = f.valorTexto.trim();
    }
    if (valor !== null) conteo.set(valor, (conteo.get(valor) ?? 0) + 1);
  }
  const ordenado = [...conteo.entries()].sort((a, b) => b[1] - a[1] || (tipo === "num" ? Number(a[0]) - Number(b[0]) : a[0].localeCompare(b[0])));
  const salida: DistribucionClave = {
    tipo,
    n: [...conteo.values()].reduce((s, x) => s + x, 0),
    distintos: conteo.size,
    top: ordenado.slice(0, 10).map(([valor, n]) => ({ valor, n })),
  };
  if (tipo === "num" && numeros.length > 0) {
    const ord = [...numeros].sort((a, b) => a - b);
    salida.num = { min: ord[0], mediana: mediana(ord), max: ord[ord.length - 1] };
  }
  return salida;
}

interface Acumulador {
  id: string | null;
  nombre: string;
  productos: number;
  sinAtributos: number;
  porClave: Map<string, number>;
}

const acumulador = (id: string | null, nombre: string): Acumulador => ({ id, nombre, productos: 0, sinAtributos: 0, porClave: new Map() });

function cerrar(a: Acumulador, claves: readonly string[]): GrupoCobertura {
  const celdas: Record<string, CeldaClave> = {};
  for (const k of claves) {
    const n = a.porClave.get(k) ?? 0;
    celdas[k] = { n, pct: porcentaje(n, a.productos) };
  }
  return { id: a.id, nombre: a.nombre, productos: a.productos, sinAtributos: a.sinAtributos, claves: celdas };
}

export const NOMBRE_SIN_CATEGORIA = "(sin categoría)";
export const NOMBRE_CATEGORIA_INACTIVA = "(categoría inactiva o desconocida)";

export function calcularCobertura(
  filas: readonly FilaUniverso[],
  atributos: readonly FilaAtributo[],
  arbol: readonly NodoCobertura[],
  opciones: OpcionesCobertura,
): Cobertura {
  const claves = [...(opciones.claves ?? CLAVES_ESTRUCTURADAS)];
  const conocidas = new Set(claves);
  const usadas = opciones.usadasHoy ?? clavesUsadasHoy();

  // Denominador: el universo elegido, con stock disponible. Un producto = una fila de `filas`.
  const enUniverso = filas.filter((f) => f.activo && f.conStock && (opciones.universo === "activos" || esPublicado(f)));
  const ids = new Set(enUniverso.map((f) => f.alegraId));

  // Atributos del universo, una sola vez por (producto, clave); lo desconocido se cuenta aparte.
  const porProducto = new Map<string, Map<string, FilaAtributo>>();
  let clavesDesconocidas = 0;
  for (const a of atributos) {
    if (!ids.has(a.alegraId)) continue;
    if (!conocidas.has(a.clave)) {
      clavesDesconocidas++;
      continue;
    }
    let m = porProducto.get(a.alegraId);
    if (!m) porProducto.set(a.alegraId, (m = new Map()));
    if (!m.has(a.clave)) m.set(a.clave, a);
  }

  const raizDe = resolverRaices(arbol);
  const nombres = new Map(arbol.map((n) => [n.id, n.nombre]));

  const global = acumulador(null, "Total");
  const sinCategoria = acumulador(null, NOMBRE_SIN_CATEGORIA);
  const inactivas = acumulador(null, NOMBRE_CATEGORIA_INACTIVA);
  const raices = new Map<string, Acumulador>(
    arbol.filter((n) => n.parentId === null).map((n) => [n.id, acumulador(n.id, n.nombre)]),
  );
  const directas = new Map<string, Acumulador>();

  const sumar = (a: Acumulador, tiene: Map<string, FilaAtributo> | undefined) => {
    a.productos++;
    if (!tiene || tiene.size === 0) a.sinAtributos++;
    if (tiene) for (const k of tiene.keys()) a.porClave.set(k, (a.porClave.get(k) ?? 0) + 1);
  };

  for (const f of enUniverso) {
    const tiene = porProducto.get(f.alegraId);
    sumar(global, tiene);
    if (f.categoriaId === null) {
      sumar(sinCategoria, tiene);
      continue;
    }
    const raiz = raizDe.get(f.categoriaId) ?? null;
    if (raiz === null || !raices.has(raiz)) {
      sumar(inactivas, tiene);
      continue;
    }
    sumar(raices.get(raiz)!, tiene);
    let d = directas.get(f.categoriaId);
    if (!d) directas.set(f.categoriaId, (d = acumulador(f.categoriaId, nombres.get(f.categoriaId) ?? f.categoriaId)));
    sumar(d, tiene);
  }

  const ordenar = (xs: Acumulador[]) =>
    xs.sort((a, b) => b.productos - a.productos || a.nombre.localeCompare(b.nombre)).map((a) => cerrar(a, claves));

  const cierreGlobal = cerrar(global, claves);
  const porClave: FilaClave[] = claves.map((clave) => ({
    clave,
    tipo: tipoDe(clave),
    usadaHoy: usadas.has(clave),
    n: cierreGlobal.claves[clave].n,
    pct: cierreGlobal.claves[clave].pct,
  }));

  const distribucion: Record<string, DistribucionClave> = {};
  for (const clave of claves) {
    const valores: FilaAtributo[] = [];
    for (const m of porProducto.values()) {
      const v = m.get(clave);
      if (v) valores.push(v);
    }
    distribucion[clave] = distribuir(clave, valores);
  }

  return {
    universo: opciones.universo,
    resumen: resumirUniverso(filas),
    claves,
    global: cierreGlobal,
    raices: ordenar([...raices.values()]),
    categorias: ordenar([...directas.values()]),
    sinCategoria: cerrar(sinCategoria, claves),
    inactivas: cerrar(inactivas, claves),
    porClave,
    distribucion,
    clavesDesconocidas,
  };
}

// ---------------------------------------------------------------------------
// Reporte (texto Markdown + JSON) y argumentos del CLI. Todo puro.
// ---------------------------------------------------------------------------

/** Lo que el reporte NO mide, declarado siempre (el reporte se pega en PRs y decisiones). */
export const LIMITES: readonly string[] = [
  "No se desglosa por `fuente` del atributo (nombre, ficha PDF o manual): la columna no está concedida al rol de lectura del Shop (shop_app). El desglose por fuente queda como seguimiento en apps/admin.",
  "No se evalúa si un valor está fuera de vocabulario o de un rango plausible: sólo se describe su distribución.",
  "Descriptivo: no define umbrales ni decide qué claves cargar; dimensiona el cambio de atributos.",
  "La disponibilidad por sucursal no se modela: 'con stock' es el stock disponible (stock menos reservado; sin control de stock cuenta como disponible).",
];

export interface CabeceraCobertura {
  /** ISO 8601. */
  fecha: string;
  gitSha: string;
  sucio: boolean;
  /** Alias legible del tenant (nunca el id real). */
  tenantAlias: string;
  universo: UniversoCobertura;
  duracionMs: number;
}

export interface EntradaReporte {
  cabecera: CabeceraCobertura;
  resumen: ResumenUniverso;
  /** `no_disponible` si no se pudo leer `catalog_atributos` (sólo el tipo de error, nunca la cadena de conexión). */
  cobertura: Cobertura | { no_disponible: string };
}

export interface ReporteCoberturaJson {
  esquema: 1;
  cabecera: CabeceraCobertura;
  universo: ResumenUniverso & { definicion: string };
  cobertura: Record<string, unknown> | { no_disponible: string };
  limites: readonly string[];
}

const DEFINICION: Record<UniversoCobertura, string> = {
  publicados: "publicados con stock: activos, con overlay visible, con precio y con stock disponible",
  activos: "activos con stock: con stock disponible, estén o no publicados",
};

const celda = (s: string | number) => String(s).replace(/\|/g, "\\|");
const fila = (celdas: (string | number)[]) => `| ${celdas.map(celda).join(" | ")} |`;
const tabla = (cabeceras: string[], filas: (string | number)[][]) =>
  [fila(cabeceras), fila(cabeceras.map(() => "---")), ...filas.map(fila)].join("\n");

function seccionMatriz(titulo: string, primera: string, grupos: readonly GrupoCobertura[], total: GrupoCobertura, claves: readonly string[]): string {
  const filasMatriz = [...grupos, total].map((g) => [g.nombre, g.productos, g.sinAtributos, ...claves.map((k) => g.claves[k].pct)]);
  return [`## ${titulo}`, "", tabla([primera, "Productos", "Sin atributos", ...claves], filasMatriz)].join("\n");
}

function textoDistribucion(clave: string, d: DistribucionClave): string {
  const cab = `- **${clave}** (${d.tipo === "num" ? "numérica" : "texto"}): ${d.n} productos con valor, ${d.distintos} valores distintos`;
  if (d.n === 0) return cab;
  const rango = d.num ? `; min ${d.num.min}, mediana ${d.num.mediana}, max ${d.num.max}` : "";
  const top = d.top.map((t) => `${t.valor} (${t.n})`).join(", ");
  return `${cab}${rango}. Más frecuentes: ${top}.`;
}

export function armarReporte(e: EntradaReporte): { json: ReporteCoberturaJson; texto: string } {
  const { cabecera, resumen, cobertura } = e;
  const universo = { ...resumen, definicion: DEFINICION[cabecera.universo] };
  const disponible = !("no_disponible" in cobertura);

  let jsonCobertura: ReporteCoberturaJson["cobertura"];
  if (!disponible) {
    jsonCobertura = { no_disponible: cobertura.no_disponible };
  } else {
    jsonCobertura = {
      global: cobertura.global,
      porClave: cobertura.porClave,
      matrizPorRaiz: cobertura.raices,
      matrizPorCategoria: cobertura.categorias,
      sinCategoria: cobertura.sinCategoria,
      categoriaInactivaODesconocida: cobertura.inactivas,
      sinAtributos: {
        global: cobertura.global.sinAtributos,
        porRaiz: [...cobertura.raices, cobertura.sinCategoria, cobertura.inactivas].map((g) => ({ categoria: g.nombre, productos: g.productos, sinAtributos: g.sinAtributos })),
      },
      distribucion: cobertura.distribucion,
      clavesUsadasHoy: cobertura.porClave.filter((f) => f.usadaHoy).map((f) => f.clave),
      clavesDesconocidas: cobertura.clavesDesconocidas,
    };
  }
  const json: ReporteCoberturaJson = { esquema: 1, cabecera, universo, cobertura: jsonCobertura, limites: LIMITES };

  const partes: string[] = [];
  partes.push(
    [
      "# Cobertura de atributos del catálogo",
      "",
      `- Fecha: ${cabecera.fecha}`,
      `- Commit: ${cabecera.gitSha}${cabecera.sucio ? " (sucio)" : ""}`,
      `- Tenant: ${cabecera.tenantAlias}`,
      `- Universo de las coberturas: ${DEFINICION[cabecera.universo]}`,
      `- Duración: ${(cabecera.duracionMs / 1000).toFixed(1)} s`,
    ].join("\n"),
  );
  partes.push(
    [
      "## Universo",
      "",
      tabla(
        ["Concepto", "Productos"],
        [
          ["Productos activos", resumen.activos],
          ["Publicados (activo, visible y con precio)", resumen.publicados],
          ["Activos con stock disponible", resumen.conStock],
          ["Publicados con stock", resumen.publicadosConStock],
          ["Activos sin categoría propia", resumen.sinCategoria],
          ["Activos sin overlay", resumen.sinOverlay],
        ],
      ),
    ].join("\n"),
  );

  if (!disponible) {
    partes.push(["## Atributos", "", `No disponible: ${cobertura.no_disponible}. Las coberturas no se calcularon.`].join("\n"));
  } else {
    const c = cobertura;
    partes.push(
      [
        "## Cobertura global por clave",
        "",
        `Denominador: ${c.global.productos} productos (${DEFINICION[c.universo]}).`,
        "",
        tabla(
          ["Clave", "Tipo", "Uso en la búsqueda", "Productos con la clave", "%"],
          c.porClave.map((f) => [f.clave, f.tipo === "num" ? "numérica" : "texto", f.usadaHoy ? "usada hoy" : "no usada", f.n, f.pct]),
        ),
        "",
        `Productos sin ningún atributo: ${c.global.sinAtributos} (${porcentaje(c.global.sinAtributos, c.global.productos)} %).`,
        ...(c.clavesDesconocidas > 0 ? [`Filas con una clave que el Shop no conoce (posible deriva con el CRM): ${c.clavesDesconocidas}.`] : []),
      ].join("\n"),
    );
    const especiales = [c.sinCategoria, c.inactivas].filter((g) => g.productos > 0);
    partes.push(seccionMatriz("Matriz por categoría raíz (% de productos con la clave)", "Categoría raíz", [...c.raices, ...especiales], c.global, c.claves));
    partes.push(seccionMatriz("Matriz por categoría asignada (% de productos con la clave)", "Categoría asignada", c.categorias, c.global, c.claves));
    partes.push(["## Distribución de valores", "", ...c.claves.map((k) => textoDistribucion(k, c.distribucion[k]))].join("\n"));
  }
  partes.push(["## Límites", "", ...LIMITES.map((l) => `- ${l}`)].join("\n"));

  return { json, texto: `${partes.join("\n\n")}\n` };
}

export interface ArgsCobertura {
  universo: UniversoCobertura;
  /** `--json=<ruta>` (alias `--salida`). */
  json?: string;
  tenantAlias: string;
}

const FLAGS_COBERTURA = ["universo", "json", "salida", "tenant-alias"];

/** Argumentos del CLI; lanza con un mensaje claro ante cualquier valor inválido (antes de abrir la base). */
export function parsearArgsCobertura(argv: readonly string[]): ArgsCobertura {
  const mapa = new Map<string, string>();
  for (const a of argv) {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    mapa.set(k, v.join("="));
  }
  for (const k of mapa.keys()) {
    if (!FLAGS_COBERTURA.includes(k)) throw new Error(`Flag desconocido: --${k}. Válidos: ${FLAGS_COBERTURA.map((f) => `--${f}`).join(", ")}.`);
  }
  const universo = mapa.get("universo") ?? "publicados";
  if (universo !== "publicados" && universo !== "activos") throw new Error("--universo inválido: use publicados|activos.");
  const json = mapa.get("json") ?? mapa.get("salida");
  if ((mapa.has("json") || mapa.has("salida")) && !json) throw new Error("--json requiere una ruta: --json=tmp/busqueda/cobertura.json.");
  const alias = mapa.get("tenant-alias");
  if (mapa.has("tenant-alias") && !alias) throw new Error("--tenant-alias requiere un valor.");
  return { universo, ...(json ? { json } : {}), tenantAlias: alias ?? "shop" };
}

// ---------------------------------------------------------------------------
// Orquestación con dependencias inyectadas (el CLI sólo cablea la lectura real).
// ---------------------------------------------------------------------------

export interface DatosCobertura {
  filas: FilaUniverso[];
  arbol: NodoCobertura[];
  /** `no_disponible`: motivo (sólo el tipo de error) si `catalog_atributos` no se pudo leer. */
  atributos: FilaAtributo[] | { no_disponible: string };
}

export interface DepsCobertura {
  /** Lectura de la base (en el CLI: UNA transacción read only con a lo sumo 3 SELECT). */
  leer: () => Promise<DatosCobertura>;
  git: () => { sha: string; sucio: boolean };
  /** Reloj en ms (duración) y fecha ISO; inyectables para tests. */
  ahora?: () => number;
}

export async function generarCobertura(args: ArgsCobertura, deps: DepsCobertura): Promise<{ json: ReporteCoberturaJson; texto: string }> {
  const ahora = deps.ahora ?? Date.now;
  const inicio = ahora();
  const datos = await deps.leer();
  const resumen = resumirUniverso(datos.filas);
  const cobertura: EntradaReporte["cobertura"] = Array.isArray(datos.atributos)
    ? calcularCobertura(datos.filas, datos.atributos, datos.arbol, { universo: args.universo })
    : datos.atributos;
  const { sha, sucio } = deps.git();
  const fin = ahora();
  return armarReporte({
    cabecera: {
      fecha: new Date(fin).toISOString(),
      gitSha: sha,
      sucio,
      tenantAlias: args.tenantAlias,
      universo: args.universo,
      duracionMs: fin - inicio,
    },
    resumen,
    cobertura,
  });
}
