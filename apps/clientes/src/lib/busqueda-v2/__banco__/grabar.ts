/**
 * `npm run banco:grabar` — graba las respuestas REALES de Jev para cada
 * búsqueda del banco en `jev-grabado.json` (las usa el test offline, que así
 * no gasta). Usa `JEV_API_KEY` del entorno; el árbol de categorías sale de la
 * base de `.env.local`, en solo lectura.
 *
 * A Jev viaja sólo lo mismo que en producción: la consulta normalizada (todas
 * sintéticas, escritas a mano) y los nombres públicos de las categorías. Los
 * códigos no se preguntan (nunca llegan a Jev). Volver a grabar sólo hace
 * falta si cambian las preguntas, el modelo o el árbol.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPaginaCatalogo, getArbolCategorias } from "@/lib/catalog";
import { JEV_MODELO, consultarJev } from "@/lib/busqueda-inteligente/jev";
import { pareceCodigo } from "@/lib/busqueda-inteligente/gate";
import { normalizarConsulta } from "@/lib/busqueda-inteligente/normalizar";
import { UMBRAL_SUB, opcionesRaiz, preguntaSub, preguntasPrincipales } from "../entender/preguntas";
import { BANCO } from "./banco";
import type { JevGrabado } from "./jev-grabado";
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

async function main() {
  if (!process.env.JEV_API_KEY?.trim()) throw new Error("Falta JEV_API_KEY en el entorno.");
  const arbol = await enLectura(() => getArbolCategorias());
  await grabarArbol(arbol);
  if (process.argv.includes("--solo-arbol")) return;
  const principales = preguntasPrincipales(arbol);
  const raices = opcionesRaiz(arbol);
  const grabado: JevGrabado = { modelo: JEV_MODELO, grabadoEl: new Date().toISOString().slice(0, 10), respuestas: {} };
  for (const b of BANCO) {
    const norm = normalizarConsulta(b.q);
    if (!norm || pareceCodigo(b.q)) continue;
    const r1 = await consultarJev(norm, principales, { timeoutMs: 10_000 });
    if (!r1) {
      console.error(`[grabar] sin respuesta para «${norm}»`);
      continue;
    }
    const entrada: JevGrabado["respuestas"][string] = { principal: r1 };
    const raiz = r1.raiz && raices?.porClave.get(r1.raiz.choice);
    if (raiz && r1.raiz!.confidence >= UMBRAL_SUB) {
      const sub = preguntaSub(arbol, raiz);
      if (sub) {
        const r2 = await consultarJev(norm, sub.preguntas, { timeoutMs: 10_000 });
        if (r2) entrada.sub = r2;
      }
    }
    grabado.respuestas[norm] = entrada;
    console.info(`[grabar] ${norm} → ${r1.intencion?.choice ?? "-"} / ${r1.raiz?.choice ?? "-"} ${entrada.sub?.sub?.choice ?? ""}`);
  }
  writeFileSync(DESTINO, `${JSON.stringify(grabado, null, 2)}\n`);
  console.info(`[grabar] ${Object.keys(grabado.respuestas).length} búsquedas grabadas`);
}

main()
  .catch((err: unknown) => {
    console.error(`[grabar] ${err instanceof Error ? err.message : "error"}`);
    process.exitCode = 1;
  })
  .finally(() => cerrar());
