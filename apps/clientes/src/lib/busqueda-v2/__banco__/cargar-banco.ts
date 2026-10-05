/**
 * Carga y validación de bancos de búsquedas (`--banco=<ruta>` y el versionado
 * `banco.json`): un solo esquema para los dos. Módulo puro salvo
 * `cargarBancoDeArchivo` (lee un archivo, nunca toca la base).
 *
 * Privacidad: un banco local puede traer consultas reales. Los errores y los
 * avisos citan sólo el índice del caso y el nombre del campo, o conteos:
 * NUNCA el texto de una consulta ni valores del archivo.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pareceDatoPersonal } from "@/lib/busqueda-inteligente/normalizar";
import {
  INTENCIONES_BANCO,
  PERFILES_BANCO,
  TIPOS_CONSULTA,
  type BusquedaBanco,
  type EtiquetadoBanco,
} from "./modelo";

export type OrigenBanco = "embebido" | "local";

export interface BancoCargado {
  version: number;
  origen: OrigenBanco;
  /** Se enmascaran las consultas en consola y reportes (ver `--ver-consultas`). */
  privado: boolean;
  extraidoEl?: string;
  /** Nombres de categoría del árbol con el que se etiquetó (para `validarBanco`). */
  categorias?: string[];
  casos: BusquedaBanco[];
}

const ETIQUETAS: readonly EtiquetadoBanco[] = ["pendiente", "propuesto", "revisado", "descartado"];
const LISTAS = ["categoria", "atributosDuros", "expande", "debeIncluirEnTop24", "categoriaEnTop24"] as const;
const BOOLEANOS = ["diagnostico", "sinDuros", "nuncaSinResultados"] as const;

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const esListaDeTextos = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Errores de un caso: campo + motivo, nunca el valor. */
function erroresDelCaso(c: unknown, i: number): string[] {
  if (!esObjeto(c)) return [`caso #${i}: no es un objeto`];
  const errores: string[] = [];
  const mal = (campo: string, motivo: string) => errores.push(`caso #${i}: campo '${campo}' ${motivo}`);
  if (typeof c.q !== "string" || !c.q.trim()) mal("q", "falta o no es un texto no vacío");
  if (c.perfil !== undefined && !PERFILES_BANCO.includes(c.perfil as never)) mal("perfil", `debe ser uno de ${PERFILES_BANCO.join("|")}`);
  if (c.intencion !== undefined && !INTENCIONES_BANCO.includes(c.intencion as never)) mal("intencion", `debe ser uno de ${INTENCIONES_BANCO.join("|")}`);
  if (c.tipo !== undefined && !TIPOS_CONSULTA.includes(c.tipo as never)) mal("tipo", `debe ser uno de ${TIPOS_CONSULTA.join("|")}`);
  if (c.etiquetado !== undefined && !ETIQUETAS.includes(c.etiquetado as never)) mal("etiquetado", `debe ser uno de ${ETIQUETAS.join("|")}`);
  if (c.peso !== undefined && !(typeof c.peso === "number" && Number.isFinite(c.peso) && c.peso > 0)) mal("peso", "debe ser un número positivo");
  for (const k of LISTAS) if (c[k] !== undefined && !esListaDeTextos(c[k])) mal(k, "debe ser una lista de textos");
  for (const k of BOOLEANOS) if (c[k] !== undefined && typeof c[k] !== "boolean") mal(k, "debe ser verdadero o falso");
  return errores;
}

/**
 * Valida y normaliza un banco (versionado o externo). Lanza un único error
 * con TODOS los problemas (índice + campo). Un caso sin `perfil` queda como
 * "desconocido" (consultas reales sin clasificar).
 */
export function parsearBanco(json: unknown, { origen }: { origen: OrigenBanco }): BancoCargado {
  if (!esObjeto(json)) throw new Error("El banco debe ser un objeto JSON con una lista 'busquedas'.");
  if (!Array.isArray(json.busquedas)) throw new Error("El banco no tiene la lista 'busquedas'.");
  const errores = json.busquedas.flatMap((c, i) => erroresDelCaso(c, i));
  if (errores.length) throw new Error(`Banco inválido (${errores.length} problema(s)):\n${errores.join("\n")}`);
  const casos = (json.busquedas as Record<string, unknown>[]).map((c) => ({ ...c, perfil: c.perfil ?? "desconocido" }) as unknown as BusquedaBanco);
  return {
    version: typeof json.version === "number" ? json.version : 1,
    origen,
    privado: json.privado === true || json.origen === "real" || origen === "local",
    ...(typeof json.extraidoEl === "string" ? { extraidoEl: json.extraidoEl } : {}),
    ...(esListaDeTextos(json.categorias) ? { categorias: json.categorias } : {}),
    casos,
  };
}

/** JSON canónico: claves ordenadas, así el hash no depende del formato del archivo. */
function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (esObjeto(v)) return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)]));
  return v;
}

/** Hash corto (12 hex) del contenido del banco: cambia si cambia un caso o su orden. */
export function hashBanco(casos: readonly BusquedaBanco[]): string {
  return createHash("sha256").update(JSON.stringify(canonico(casos))).digest("hex").slice(0, 12);
}

export type ModoEtiquetas = "revisado" | "todas";

export interface CasosFiltrados {
  casos: BusquedaBanco[];
  /** Casos que no entraron, por estado (sólo conteos). */
  excluidos: { pendiente: number; propuesto: number; descartado: number };
}

/** `revisado` (default): sólo lo revisado o sin estado (el banco versionado no lo trae). `todas`: sin filtro. */
export function filtrarEtiquetas(casos: readonly BusquedaBanco[], modo: ModoEtiquetas): CasosFiltrados {
  const excluidos = { pendiente: 0, propuesto: 0, descartado: 0 };
  if (modo === "todas") return { casos: [...casos], excluidos };
  const entran = casos.filter((c) => {
    if (!c.etiquetado || c.etiquetado === "revisado") return true;
    excluidos[c.etiquetado]++;
    return false;
  });
  return { casos: entran, excluidos };
}

export interface ValidacionBanco {
  categoriaFueraDelArbol: number;
  sinExpectativa: number;
  datoPersonal: number;
  /** Avisos legibles: sólo conteos. */
  avisos: string[];
}

const tieneExpectativa = (c: BusquedaBanco) =>
  !!(c.categoria?.length || c.atributosDuros?.length || c.expande?.length || c.debeIncluirEnTop24?.length || c.categoriaEnTop24?.length || c.sinDuros || c.intencion);

/** Avisos (no bloquean): categorías fuera del árbol, casos sin expectativa y consultas que parecen datos personales. */
export function validarBanco(casos: readonly BusquedaBanco[], categoriasVigentes?: readonly string[]): ValidacionBanco {
  const vigentes = categoriasVigentes ? new Set(categoriasVigentes) : null;
  const categoriaFueraDelArbol = vigentes
    ? casos.filter((c) => [...(c.categoria ?? []), ...(c.categoriaEnTop24 ?? [])].some((n) => !vigentes.has(n))).length
    : 0;
  const sinExpectativa = casos.filter((c) => !tieneExpectativa(c)).length;
  const datoPersonal = casos.filter((c) => pareceDatoPersonal(c.q)).length;
  const avisos: string[] = [];
  if (categoriaFueraDelArbol) avisos.push(`${categoriaFueraDelArbol} caso(s) con categorías que no están en el árbol vigente`);
  if (sinExpectativa) avisos.push(`${sinExpectativa} caso(s) sin ninguna expectativa (no aportan a las métricas)`);
  if (datoPersonal) avisos.push(`${datoPersonal} caso(s) cuya consulta parece un dato personal (email, teléfono, documento)`);
  return { categoriaFueraDelArbol, sinExpectativa, datoPersonal, avisos };
}

/** Lee un banco externo. Sin base de datos; los errores no vuelcan el contenido del archivo. */
export function cargarBancoDeArchivo(ruta: string): BancoCargado {
  let texto: string;
  try {
    texto = readFileSync(ruta, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`No existe el archivo de banco: ${ruta}`);
    throw new Error(`No se pudo leer el archivo de banco: ${ruta}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    // El mensaje de JSON.parse cita un fragmento del contenido: no se reenvía.
    throw new Error(`El archivo de banco no es un JSON válido: ${ruta}`);
  }
  return parsearBanco(json, { origen: "local" });
}
