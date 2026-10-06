/**
 * `npm run banco:linea-base` — la CORRIDA CONGELADA de la línea base de la
 * búsqueda: una sola conexión, un solo snapshot del catálogo y un solo sha
 * para toda la matriz (tuberías x vistas x bancos, ver matriz.ts). SOLO
 * LECTURA (cada búsqueda en una transacción `read only`).
 *
 *   npm run banco:linea-base -- --solo-visibles=<si|no> [--comparar=<matriz.json|carpeta>] \
 *     --flags=busqueda-ia:on,catalogo-solo-visibles:<on|off>,disponibilidad-sucursal:<on|off> \
 *     --banco-real=tmp/busqueda/banco-real.local.json --repeticiones=3 \
 *     --dir=tmp/busqueda/linea-base-<fecha>
 *
 * Con `--motor` suma las filas de la tubería `motor` (el motor único de búsqueda, política `legado`:
 * catálogo en las dos vistas; autocompletar y chat en producción). Sus filas legado tienen que
 * igualar las de la corrida congelada (misma cabecera) y de ahí sale la matriz de cada cambio.
 *
 * Escribe en `--dir` (por defecto `tmp/busqueda/linea-base-<fecha>/`, ignorado por git):
 *   matriz.json  todas las corridas con su cabecera (el banco real va enmascarado)
 *   matriz.txt   tabla motor x métricas, SÓLO agregados (apta para pegar)
 *   LEEME.txt    cómo se generó y cómo reproducirla
 * Una carpeta con matriz.json ya escrito NO se pisa: queda congelada.
 * `--comparar` lee ANTES de abrir la base una línea base congelada y, al final, imprime el delta de hit@24,
 * medida-precision@24, contradicciones@24, zero-result y p95 por corrida y por tipo (y lo guarda en comparacion.txt).
 * Sale 0 siempre (es medición, no hay umbral). Jev vivo sólo con `--jev=vivo`
 * explícito (gasta; sólo sobre el banco sintético).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getArbolCategorias } from "@/lib/catalog";
import { atributosEstructuradosDisponibles } from "@/lib/catalogo-atributos-disponibles";
import { cargarBancoDeArgs, estadoMedidas } from "./args";
import { compararMatrices, leerSnapshot } from "./comparar";
import { correr, gitInfo } from "./corrida";
import { crearEjecutor, resolverJev } from "./ejecutores";
import { cerrar, enLectura } from "./lectura";
import { formatearMatriz, parsearArgsLinea, planDeMatriz, type ArgsLinea, type CorridaDeMatriz } from "./matriz";
import { resolverSalida } from "./ruta-salida";
import { cargarFilasUniverso, snapshotCatalogo } from "./universo";
import { VISTA_ACTUAL, vistaProduccion } from "./vista";

/** La conexión sólo se cierra si se llegó a abrir. */
let conexionAbierta = false;

function leeme(a: ArgsLinea, sha: { sha: string; sucio: boolean }, fecha: string): string {
  const flags = Object.entries(a.flags).map(([k, v]) => `${k}:${v}`).join(",");
  return [
    "Línea base de la búsqueda — corrida congelada",
    "",
    `Generada el ${fecha} sobre el commit ${sha.sha}${sha.sucio ? " (con cambios sin commitear)" : ""}.`,
    "",
    "Para reproducirla (en apps/clientes, mismo commit, mismo banco y misma base):",
    `  npm run banco:linea-base -- --solo-visibles=${a.soloVisibles ? "si" : "no"}${flags ? ` --flags=${flags}` : ""}${a.bancoReal ? ` --banco-real=${a.bancoReal}` : ""} --repeticiones=${a.repeticiones} --calentar=${a.calentar}${a.jevVivo ? " --jev=vivo" : ""}${a.motor ? " --motor" : ""}${a.medidas ? "" : " --medidas=no"}`,
    "",
    "Contenido:",
    "  matriz.json  todas las corridas con su cabecera (banco real: consultas enmascaradas)",
    "  matriz.txt   tabla motor x métricas (sólo agregados)",
    "",
    "Comparar corridas SÓLO con la misma cabecera (hash de banco, snapshot, vista, Jev).",
    "No regenerar este directorio: es la línea base congelada.",
    "",
  ].join("\n");
}

async function main(a: ArgsLinea) {
  // Antes de abrir la base: un snapshot inexistente o inválido falla acá.
  const anterior = a.comparar ? leerSnapshot(a.comparar) : undefined;
  const sintetico = cargarBancoDeArgs({ etiquetas: "revisado" }).banco;
  // Antes de abrir la base: un banco real inexistente o inválido falla acá.
  const real = a.bancoReal ? cargarBancoDeArgs({ banco: a.bancoReal, etiquetas: a.etiquetas }) : undefined;

  const fecha = new Date().toISOString().slice(0, 10);
  const { ruta: dir, advertencia } = resolverSalida(a.dir ?? join("tmp", "busqueda", `linea-base-${fecha}`), { estricto: false });
  if (advertencia) console.warn(advertencia);
  if (existsSync(join(dir, "matriz.json"))) throw new Error(`Ya hay una línea base en ${dir}: queda congelada. Use otro --dir.`);

  conexionAbierta = true;
  const [arbol, estructurados] = await Promise.all([
    enLectura(() => getArbolCategorias()),
    enLectura(() => atributosEstructuradosDisponibles()).catch(() => false),
  ]);
  const snapshot = await snapshotCatalogo(arbol, estructurados, () => enLectura(() => cargarFilasUniverso()));
  const git = gitInfo();
  const plan = planDeMatriz({ bancoReal: !!real, jevVivo: a.jevVivo, motor: a.motor });
  console.info(`[linea-base] ${plan.length} corridas; ${arbol.length} categorías; estructurados ${estructurados}; repeticiones ${a.repeticiones}`);

  const corridas: CorridaDeMatriz[] = [];
  for (const [i, e] of plan.entries()) {
    const vista = e.vista === "banco" ? VISTA_ACTUAL : vistaProduccion(a.soloVisibles);
    const jev = resolverJev(e.jev, false);
    const ejecutor = crearEjecutor({ tuberia: e.tuberia, jev, vista, arbol, estructurados, soloVisiblesDelPlan: a.soloVisibles, politica: e.politica, superficie: e.superficie, medidas: a.medidas });
    const banco = e.banco === "real" && real ? real.banco : sintetico;
    const { json } = await correr(
      {
        tuberia: e.tuberia,
        jev,
        jevMeta: ejecutor.jevMeta,
        vista,
        produccion: e.vista === "produccion",
        ...(e.politica ? { politica: e.politica } : {}),
        ...(e.superficie ? { superficie: e.superficie } : {}),
        banco,
        repeticiones: a.repeticiones,
        calentar: a.calentar,
        flagsDeclarados: a.flags,
        busquedaMedidas: estadoMedidas(e.tuberia, a.medidas),
        verConsultas: false,
        tenantAlias: a.tenantAlias,
      },
      {
        arbol,
        snapshot,
        git: () => git,
        sinGrabacion: ejecutor.sinGrabacion,
        log: (m) => console.error(m),
        ejecutar: (q) => enLectura(() => ejecutor.ejecutar(q)),
      },
    );
    corridas.push({ id: e.id, banco: e.banco, vista: e.vista, tuberia: e.tuberia, jev, ...(e.politica ? { politica: e.politica } : {}), ...(e.superficie ? { superficie: e.superficie } : {}), reporte: json });
    console.info(`[linea-base] ${i + 1}/${plan.length} ${e.id} (${json.cabecera.duracionMs} ms)`);
  }

  mkdirSync(dir, { recursive: true });
  const texto = formatearMatriz(corridas);
  writeFileSync(join(dir, "matriz.json"), `${JSON.stringify({ esquema: 1, generadoEl: fecha, corridas }, null, 2)}\n`);
  writeFileSync(join(dir, "matriz.txt"), texto);
  writeFileSync(join(dir, "LEEME.txt"), leeme(a, git, fecha));
  console.log(texto);
  if (anterior) {
    const comparacion = compararMatrices(anterior, { esquema: 1, generadoEl: fecha, corridas });
    writeFileSync(join(dir, "comparacion.txt"), comparacion);
    console.log(comparacion);
  }
  console.info(`[linea-base] escrito en ${dir}`);
}

let args: ArgsLinea;
try {
  args = parsearArgsLinea(process.argv.slice(2));
} catch (err) {
  console.error(`[linea-base] ${err instanceof Error ? err.message : "argumentos inválidos"}`);
  process.exit(1);
}

main(args)
  .catch((err: unknown) => {
    console.error(`[linea-base] ${err instanceof Error ? err.message : "error"}`);
    process.exitCode = 1;
  })
  .finally(() => (conexionAbierta ? cerrar() : undefined));
