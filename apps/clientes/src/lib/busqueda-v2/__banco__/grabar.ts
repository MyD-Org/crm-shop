/**
 * `npm run banco:grabar` — graba las respuestas REALES de Jev para cada
 * búsqueda del banco en `jev-grabado.json` (las usa el test offline, que así
 * no gasta). Usa `JEV_API_KEY` del entorno; el árbol de categorías sale de la
 * base de `.env.local`, en solo lectura.
 *
 * `npm run banco:grabar -- --solo-faltantes` — graba SÓLO las consultas del
 * banco que todavía no tienen respuesta y las MEZCLA en `jev-grabado.json` sin
 * tocar lo existente. NO usa la base ni escribe `arbol-grabado.json` (las
 * preguntas se arman con ese árbol, los mismos nombres de las grabaciones
 * previas): sólo necesita `JEV_API_KEY`. Si el modelo de Jev cambió, aborta
 * (hay que regrabar todo, sin este flag).
 *
 * A Jev viaja sólo lo mismo que en producción: la consulta normalizada (todas
 * sintéticas, escritas a mano) y los nombres públicos de las categorías. Los
 * códigos no se preguntan (nunca llegan a Jev). Volver a grabar sólo hace
 * falta si cambian las preguntas, el modelo o el árbol.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPaginaCatalogo, getArbolCategorias } from "@/lib/catalog";
import { JEV_MODELO, consultarJev } from "@/lib/busqueda-inteligente/jev";
import { pareceCodigo } from "@/lib/busqueda-inteligente/gate";
import { normalizarConsulta } from "@/lib/busqueda-inteligente/normalizar";
import type { NodoArbol } from "@/lib/busqueda-inteligente/tipos";
import { UMBRAL_SUB, opcionesRaiz, preguntaSub, preguntasPrincipales } from "../entender/preguntas";
import { BANCO } from "./banco";
import arbolGrabado from "./arbol-grabado.json";
import { faltantes, mezclar, type JevGrabado } from "./jev-grabado";
import { cerrar, enLectura } from "./lectura";

const DESTINO = fileURLToPath(new URL("./jev-grabado.json", import.meta.url));
const DESTINO_ARBOL = fileURLToPath(new URL("./arbol-grabado.json", import.meta.url));

/**
 * El árbol para el test offline: nombres, jerarquía y orden (los ids se
 * reemplazan por unos sintéticos) y las categorías sin productos (con todo su
 * subárbol), que nunca pueden quedar duras.
 */
async function grabarArbol(arbol: Awaited<ReturnType<typeof getArbolCategorias>>) {
  const ids = new Map(arbol.map((n, i) => [n.id, `cat-${String(i + 1).padStart(3, "0")}`]));
  const vacias: string[] = [];
  for (const n of arbol) {
    const { total } = await enLectura(() =>
      getPaginaCatalogo({ filtros: { categorias: [n.nombre] }, pagina: 1, porPagina: 1, soloVisibles: false }),
    );
    if (total === 0) vacias.push(n.nombre);
  }
  const salida = {
    arbol: arbol
      .map((n) => ({ id: ids.get(n.id)!, parentId: n.parentId ? (ids.get(n.parentId) ?? null) : null, nombre: n.nombre, orden: n.orden }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    vacias: vacias.sort(),
  };
  writeFileSync(DESTINO_ARBOL, `${JSON.stringify(salida, null, 2)}\n`);
}

type Entrada = JevGrabado["respuestas"][string];

/** Pregunta a Jev por una consulta ya normalizada (la principal y, si la raíz sale firme, la subcategoría). */
async function preguntarUna(
  norm: string,
  arbol: NodoArbol[],
  principales: ReturnType<typeof preguntasPrincipales>,
  raices: ReturnType<typeof opcionesRaiz>,
): Promise<Entrada | null> {
  const r1 = await consultarJev(norm, principales, { timeoutMs: 10_000 });
  if (!r1) {
    console.error(`[grabar] sin respuesta para «${norm}»`);
    return null;
  }
  const entrada: Entrada = { principal: r1 };
  const raiz = r1.raiz && raices?.porClave.get(r1.raiz.choice);
  if (raiz && r1.raiz!.confidence >= UMBRAL_SUB) {
    const sub = preguntaSub(arbol, raiz);
    if (sub) {
      const r2 = await consultarJev(norm, sub.preguntas, { timeoutMs: 10_000 });
      if (r2) entrada.sub = r2;
    }
  }
  console.info(`[grabar] ${norm} → ${r1.intencion?.choice ?? "-"} / ${r1.raiz?.choice ?? "-"} ${entrada.sub?.sub?.choice ?? ""}`);
  return entrada;
}

/** Sólo la base se abre en el modo completo: `--solo-faltantes` no la toca. */
let usaBase = false;

async function grabarFaltantes() {
  const actual = JSON.parse(readFileSync(DESTINO, "utf8")) as JevGrabado;
  if (actual.modelo !== JEV_MODELO) {
    throw new Error(`El modelo de Jev cambió (${actual.modelo} → ${JEV_MODELO}): regrabe todo con banco:grabar, sin --solo-faltantes.`);
  }
  const pendientes = faltantes(BANCO, actual);
  if (!pendientes.length) {
    console.info("[grabar] no hay consultas sin grabar: nada para hacer.");
    return;
  }
  console.info(`[grabar] ${pendientes.length} consulta(s) sin grabar (sintéticas del banco versionado; sólo nombres de categorías viajan junto a ellas)`);
  const arbol = (arbolGrabado as { arbol: NodoArbol[] }).arbol;
  const principales = preguntasPrincipales(arbol);
  const raices = opcionesRaiz(arbol);
  const nuevas: JevGrabado["respuestas"] = {};
  for (const norm of pendientes) {
    const entrada = await preguntarUna(norm, arbol, principales, raices);
    if (entrada) nuevas[norm] = entrada;
  }
  const mezcla = mezclar(actual, nuevas, new Date().toISOString().slice(0, 10));
  writeFileSync(DESTINO, `${JSON.stringify(mezcla, null, 2)}\n`);
  console.info(`[grabar] ${Object.keys(nuevas).length}/${pendientes.length} grabadas; el archivo tiene ${Object.keys(mezcla.respuestas).length} búsquedas`);
}

async function main() {
  if (!process.env.JEV_API_KEY?.trim()) throw new Error("Falta JEV_API_KEY en el entorno.");
  if (process.argv.includes("--solo-faltantes")) return grabarFaltantes();
  usaBase = true;
  const arbol = await enLectura(() => getArbolCategorias());
  await grabarArbol(arbol);
  if (process.argv.includes("--solo-arbol")) return;
  const principales = preguntasPrincipales(arbol);
  const raices = opcionesRaiz(arbol);
  const grabado: JevGrabado = { modelo: JEV_MODELO, grabadoEl: new Date().toISOString().slice(0, 10), respuestas: {} };
  for (const b of BANCO) {
    const norm = normalizarConsulta(b.q);
    if (!norm || pareceCodigo(b.q)) continue;
    const entrada = await preguntarUna(norm, arbol, principales, raices);
    if (entrada) grabado.respuestas[norm] = entrada;
  }
  writeFileSync(DESTINO, `${JSON.stringify(grabado, null, 2)}\n`);
  console.info(`[grabar] ${Object.keys(grabado.respuestas).length} búsquedas grabadas`);
}

main()
  .catch((err: unknown) => {
    console.error(`[grabar] ${err instanceof Error ? err.message : "error"}`);
    process.exitCode = 1;
  })
  .finally(() => (usaBase ? cerrar() : undefined));
