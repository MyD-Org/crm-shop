/**
 * `npm run banco:busqueda` — el banco en vivo, SOLO LECTURA contra la base de
 * `.env.local` (cada búsqueda en una transacción `read only`, ver lectura.ts).
 *
 *   npm run banco:busqueda                       # v2, Jev grabado, umbral 85 (como siempre)
 *   npm run banco:busqueda -- --umbral=70 --salida=reporte.txt --solo=diagnostico
 *   npm run banco:busqueda -- --jev=vivo         # v2 con Jev en vivo (por defecto, las respuestas grabadas)
 *   npm run banco:busqueda -- --jev=no           # v2 sólo determinista (como la página sin caché)
 *
 * Línea base de la búsqueda (todo aditivo; sin estos flags nada cambia):
 *   --tuberia=clasica|tolerante|v2        la búsqueda sola, sin plan ni Jev (clasica = AND de LIKE;
 *                                          tolerante = contiene OR similitud de trigramas)
 *   --jev=grabado|vivo|no|cache            cache = el plan que sirvió la caché de producción (sin costo)
 *   --produccion --solo-visibles=si|no     lo que ve el cliente (valor de `catalogo-solo-visibles`)
 *   --flags=busqueda-ia:on,...             flags de Vercel DECLARADOS en la cabecera (no se leen)
 *   --banco=<ruta> [--etiquetas=todas]     banco externo (p. ej. tmp/banco-real.local.json); sólo `revisado`
 *   --json=<ruta>                          reporte JSON con cabecera reproducible (use tmp/…: ignorado por git)
 *   --repeticiones=3 --calentar=3          p50/p95 menos ruidosos (la relevancia sale de la 1ra repetición)
 *   --ver-consultas                        muestra las consultas de un banco privado (sólo consola local)
 *   --tenant-alias=demo                    alias del tenant en la cabecera (nunca el id real)
 *
 * Motor único de búsqueda (todo aditivo):
 *   --tuberia=motor                        la búsqueda del Shop por la fachada `buscar()` y su cascada (jev como v2: grabado|vivo|no|cache)
 *   --superficie=catalogo|autocompletar|chat  qué superficie se mide: K = 24 | 8 | 10, con o sin conteo del total
 *   --paridad-con=<json>                   el motor contra los ids de una corrida previa (`--json`+`--ids`), caso por caso: top-K de ids,
 *                                          orden y, en el catálogo, el total. Exige la misma cabecera; exit 1 si hay alguna diferencia
 *   --ids                                  guarda en el JSON los ids de lo devuelto por caso (archivo local ignorado por git; nunca a consola)
 *
 * Reporta por búsqueda y en total: intención, categoría, atributos explícitos,
 * producto esperado en la primera página (24), posición del primero y "sin
 * resultados" indebidos; debajo, las métricas ampliadas (hit@24, MRR,
 * precision@24, zero-result, p50/p95) y los cortes por perfil, intención y tipo.
 * Sale con código 1 si el puntaje baja del umbral (v2 por defecto 85; el resto 0).
 *
 * Nunca imprime variables de entorno ni nombres de productos (repo público:
 * el reporte se puede pegar en un PR). Un banco externo enmascara sus consultas.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getArbolCategorias } from "@/lib/catalog";
import { atributosEstructuradosDisponibles } from "@/lib/catalogo-atributos-disponibles";
import { cargarBancoDeArgs, estadoMedidas, parsearArgs, type ArgsBanco } from "./args";
import { validarBanco } from "./cargar-banco";
import { SUPERFICIES_BANCO, correr, sonComparables, type ReporteJson } from "./corrida";
import { crearEjecutor } from "./ejecutores";
import { cerrar, enLectura } from "./lectura";
import { compararParidad, formatearParidad, idsDeReporte } from "./paridad";
import { resolverSalida } from "./ruta-salida";
import { cargarFilasUniverso, snapshotCatalogo } from "./universo";
import { VISTA_ACTUAL, vistaProduccion } from "./vista";

/** Escribe un archivo (creando carpetas) y avisa si la ruta no está ignorada por git. */
function escribirSalida(ruta: string, contenido: string) {
  const { ruta: destino, advertencia } = resolverSalida(ruta, { estricto: false });
  if (advertencia) console.warn(advertencia);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, contenido);
}

/** La conexión sólo se cierra si se llegó a abrir (un argumento o un banco inválido no la toca). */
let conexionAbierta = false;

async function main(args: ArgsBanco) {
  for (const aviso of args.avisos) console.warn(aviso);
  // Antes de abrir la base: el banco externo inexistente o inválido falla acá, sin tocarla.
  const elegido = cargarBancoDeArgs(args);

  conexionAbierta = true;
  const [arbol, estructurados] = await Promise.all([
    enLectura(() => getArbolCategorias()),
    // Sin la tabla, la consulta falla y la transacción no puede confirmar: también es "no".
    enLectura(() => atributosEstructuradosDisponibles()).catch(() => false),
  ]);
  const jev = args.jev;
  console.info(`[banco] tubería ${args.tuberia}; ${arbol.length} categorías; estructurados ${estructurados}; Jev ${jev === "no aplica" ? "no aplica" : jev === "no" ? "no" : jev}`);
  if (elegido.banco.local) {
    const { excluidos } = elegido;
    const fuera = excluidos.pendiente + excluidos.propuesto + excluidos.descartado;
    console.info(`[banco] banco ${elegido.banco.origen}: ${elegido.banco.casos.length} caso(s)${fuera ? `; ${fuera} fuera por etiqueta (pendiente ${excluidos.pendiente}, propuesto ${excluidos.propuesto}, descartado ${excluidos.descartado})` : ""}`);
    for (const aviso of validarBanco(elegido.banco.casos, arbol.map((n) => n.nombre)).avisos) console.warn(`[banco] ${aviso}`);
  }

  const vista = args.produccion ? vistaProduccion(args.soloVisibles ?? false) : VISTA_ACTUAL;
  const config = { tuberia: args.tuberia, jev, vista, arbol, estructurados, superficie: args.superficie, medidas: args.medidas } as const;
  const ejecutor = crearEjecutor(config);
  const enmascarar = (elegido.banco.privado || elegido.banco.local) && !args.verConsultas;
  const snapshot = await snapshotCatalogo(arbol, estructurados, () => enLectura(() => cargarFilasUniverso()));

  const resultado = await correr(
    {
      tuberia: args.tuberia,
      jev,
      jevMeta: ejecutor.jevMeta,
      vista,
      produccion: args.produccion,
      banco: elegido.banco,
      repeticiones: args.repeticiones,
      calentar: args.calentar,
      flagsDeclarados: args.flags,
      busquedaMedidas: estadoMedidas(args.tuberia, args.medidas),
      verConsultas: args.verConsultas,
      tenantAlias: args.tenantAlias,
      umbral: args.umbral,
      ...(args.solo ? { parcial: args.solo } : {}),
      ...(args.superficie ? { superficie: args.superficie } : {}),
      ids: args.ids,
    },
    {
      arbol,
      snapshot,
      sinGrabacion: ejecutor.sinGrabacion,
      log: (m) => console.error(m),
      ejecutar: async (q) => {
        const r = await enLectura(() => ejecutor.ejecutar(q));
        // `--ver=N`: sólo consola, nunca en el reporte guardado. Un banco privado no muestra la consulta.
        if (args.ver) console.info(`  ${enmascarar ? "(consulta oculta)" : `«${q}»`} → ${r.productos.slice(0, args.ver).map((p) => p.name.slice(0, 50)).join(" | ")}`);
        return r;
      },
    },
  );
  console.log(resultado.texto);
  if (args.salida) escribirSalida(args.salida, resultado.texto);
  if (args.json) escribirSalida(args.json, `${JSON.stringify(resultado.json, null, 2)}\n`);

  if (args.paridadCon) {
    const superficie = SUPERFICIES_BANCO[args.superficie ?? "catalogo"];
    const otra = JSON.parse(readFileSync(args.paridadCon, "utf8")) as ReporteJson;
    if (otra.esquema !== 1 || !Array.isArray(otra.casos) || otra.cabecera?.tuberia !== "motor") {
      throw new Error("--paridad-con espera el --json de una corrida previa con --tuberia=motor y --ids.");
    }
    const comparables = sonComparables(otra.cabecera, resultado.json.cabecera);
    if (!comparables.ok) {
      // Cabecera distinta: no hay veredicto de paridad.
      console.error(`[paridad] no comparable: ${comparables.motivos.join("; ")}.`);
      process.exitCode = 1;
    } else {
      const r = compararParidad(idsDeReporte(resultado.json), idsDeReporte(otra), { n: superficie.k, conteo: superficie.conteo });
      console.log(formatearParidad(r, { enmascarar, consultas: elegido.banco.casos.map((c) => c.q) }));
      if (r.diferencias.length) process.exitCode = 1;
    }
  }
  if (resultado.puntaje < args.umbral) {
    console.error(`[banco] puntaje ${resultado.puntaje} < umbral ${args.umbral}`);
    process.exitCode = 1;
  }
}

let args: ArgsBanco;
try {
  args = parsearArgs(process.argv.slice(2));
} catch (err) {
  // Argumento inválido: se informa y se sale sin abrir ninguna conexión.
  console.error(`[banco] ${err instanceof Error ? err.message : "argumentos inválidos"}`);
  process.exit(1);
}

main(args)
  .catch((err: unknown) => {
    console.error(`[banco] ${err instanceof Error ? err.message : "error"}`);
    process.exitCode = 1;
  })
  .finally(() => (conexionAbierta ? cerrar() : undefined));
