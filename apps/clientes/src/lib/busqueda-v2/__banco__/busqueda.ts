/**
 * `npm run banco:busqueda` — el banco en vivo, SOLO LECTURA contra la base de
 * `.env.local` (cada búsqueda en una transacción `read only`, ver lectura.ts).
 *
 *   npm run banco:busqueda                       # v2, umbral por defecto
 *   npm run banco:busqueda -- --tuberia=fase1    # línea de base (fase 1, Jev en vivo si hay JEV_API_KEY)
 *   npm run banco:busqueda -- --umbral=70 --salida=reporte.txt --solo=diagnostico
 *   npm run banco:busqueda -- --jev=vivo         # v2 con Jev en vivo (por defecto, las respuestas grabadas)
 *   npm run banco:busqueda -- --jev=no           # v2 sólo determinista (como la página sin caché)
 *
 * Reporta por búsqueda y en total: intención, categoría, atributos explícitos,
 * producto esperado en la primera página (24), posición del primero y "sin
 * resultados" indebidos. Sale con código 1 si el puntaje baja del umbral.
 *
 * Nunca imprime variables de entorno ni nombres de productos (repo público:
 * el reporte se puede pegar en un PR).
 */
import { writeFileSync } from "node:fs";
import { getArbolCategorias } from "@/lib/catalog";
import { atributosEstructuradosDisponibles } from "@/lib/catalogo-atributos-disponibles";
import { consultarJev } from "@/lib/busqueda-inteligente/jev";
import { BANCO, evaluar, reporte, resumir, type EvaluacionBusqueda, type ResultadoBanco } from "./banco";
import { ejecutarFase1 } from "./fase1";
import { ejecutarV2 } from "./v2";
import grabado from "./jev-grabado.json";
import { jevGrabado, type JevGrabado } from "./jev-grabado";
import { cerrar, enLectura } from "./lectura";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "1"] as const;
  }),
);
const tuberia = args.get("tuberia") ?? "v2";
const umbral = Number(args.get("umbral") ?? (tuberia === "fase1" ? 0 : 85));
const salida = args.get("salida");
const soloDiagnostico = args.get("solo") === "diagnostico";
/** `--ver=N`: muestra (sólo en consola, nunca en el reporte guardado) los N primeros productos. */
const ver = Number(args.get("ver") ?? 0);

async function main() {
  const [arbol, estructurados] = await Promise.all([
    enLectura(() => getArbolCategorias()),
    // Sin la tabla, la consulta falla y la transacción no puede confirmar: también es "no".
    enLectura(() => atributosEstructuradosDisponibles()).catch(() => false),
  ]);
  const conJev = !!process.env.JEV_API_KEY?.trim();
  console.info(`[banco] tubería ${tuberia}; ${arbol.length} categorías; estructurados ${estructurados}; Jev ${conJev ? "sí" : "no"}`);

  const ejecutar = await tuberiaDe(tuberia, { arbol, estructurados, conJev });
  const busquedas = soloDiagnostico ? BANCO.filter((b) => b.diagnostico) : BANCO;
  const evaluaciones: EvaluacionBusqueda[] = [];
  const tiempos: number[] = [];
  for (const b of busquedas) {
    try {
      const r = await enLectura(() => ejecutar(b.q));
      if (r.ms != null) tiempos.push(r.ms);
      if (ver) console.info(`  «${b.q}» → ${r.productos.slice(0, ver).map((p) => p.name.slice(0, 50)).join(" | ")}`);
      evaluaciones.push(evaluar(b, r, arbol));
    } catch (err) {
      console.error(`[banco] falló «${b.q}»: ${err instanceof Error ? err.message.slice(0, 200) : "desconocido"}`);
      evaluaciones.push(evaluar(b, vacio(), arbol));
    }
  }
  const conIntencion = tuberia !== "fase1";
  const ordenados = [...tiempos].sort((a, b) => a - b);
  const p50 = ordenados[Math.floor(ordenados.length / 2)] ?? 0;
  const texto = `${reporte(`Banco de búsquedas — tubería ${tuberia}`, evaluaciones, conIntencion)}\n\nms p50 por búsqueda: ${p50}\n`;
  console.log(texto);
  if (salida) writeFileSync(salida, texto);
  const { puntaje } = resumir(evaluaciones, conIntencion);
  if (puntaje < umbral) {
    console.error(`[banco] puntaje ${puntaje} < umbral ${umbral}`);
    process.exitCode = 1;
  }
}

function vacio(): ResultadoBanco {
  return { categoriasDuras: [], categoriasBlandas: [], atributosDuros: [], expansiones: [], productos: [], total: 0 };
}

type Ejecutor = (q: string) => Promise<ResultadoBanco>;

async function tuberiaDe(
  nombre: string,
  ctx: { arbol: Awaited<ReturnType<typeof getArbolCategorias>>; estructurados: boolean; conJev: boolean },
): Promise<Ejecutor> {
  if (nombre === "fase1") {
    const jev = ctx.conJev
      ? (consulta: string, preguntas: Parameters<typeof consultarJev>[1], timeoutMs: number) =>
          consultarJev(consulta, preguntas, { timeoutMs })
      : null;
    return (q) => ejecutarFase1(q, { arbol: ctx.arbol, jev, estructurados: ctx.estructurados });
  }
  if (nombre === "v2") {
    const modo = args.get("jev") ?? "grabado";
    const jev =
      modo === "no"
        ? null
        : modo === "vivo"
          ? (consulta: string, preguntas: Parameters<typeof consultarJev>[1], timeoutMs: number) =>
              consultarJev(consulta, preguntas, { timeoutMs })
          : jevGrabado(grabado as JevGrabado);
    console.info(`[banco] Jev: ${modo}`);
    return (q) => ejecutarV2(q, { arbol: ctx.arbol, jev, estructurados: ctx.estructurados });
  }
  throw new Error(`tubería desconocida: ${nombre}`);
}

main()
  .catch((err: unknown) => {
    console.error(`[banco] ${err instanceof Error ? err.message : "error"}`);
    process.exitCode = 1;
  })
  .finally(() => cerrar());
