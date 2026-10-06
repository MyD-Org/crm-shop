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
import claves from "@/db/__fixtures__/atributos-claves.json";
import { pareceDatoPersonal } from "@/lib/busqueda-inteligente/normalizar";
import { CLAVES_ENTERAS, CURVAS, DIMENSION_MM, RANGOS, ZOCALOS, esClaveMedida } from "@/lib/catalogo-atributos-medida";
import {
  CLAVES_DISCRETAS_BANCO,
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

const TIPOS_CLAVE = claves.tipos as Record<string, "num" | "texto">;
const esClaveDelContrato = (c: unknown): c is string => typeof c === "string" && c in TIPOS_CLAVE;
const RE_DIM = /^[1-9]\d{0,3}(?:x[1-9]\d{0,3}){1,2}$/;

/** ¿El valor numérico entra en el rango de la clave (el mismo del parser de medidas)? Sin rango conocido, cualquier finito. */
function numeroEnRango(clave: string, n: number): boolean {
  if (!Number.isFinite(n)) return false;
  const r = esClaveMedida(clave) ? RANGOS[clave] : undefined;
  return !r || (n >= r[0] && n <= r[1]);
}

/** Errores de una medida esperada: campo + motivo, nunca el valor. */
function erroresDeMedida(m: unknown, campo: string): string[] {
  if (!esObjeto(m)) return [`'${campo}' no es un objeto`];
  if (!esClaveDelContrato(m.clave)) return [`'${campo}.clave' no es una clave de atributos-claves.json`];
  const clave = m.clave;
  const errores: string[] = [];
  const tieneValor = m.valor !== undefined;
  const tieneRango = m.min !== undefined || m.max !== undefined;
  if (tieneValor === tieneRango) errores.push(`'${campo}' debe traer 'valor' o un rango 'min'/'max' (exactamente una forma)`);
  if (tieneValor) {
    const v = m.valor;
    if (TIPOS_CLAVE[clave] === "num") {
      if (typeof v !== "number" || !numeroEnRango(clave, v)) errores.push(`'${campo}.valor' debe ser un número dentro del rango de la clave`);
      else if ((CLAVES_ENTERAS as readonly string[]).includes(clave) && !Number.isInteger(v)) errores.push(`'${campo}.valor' debe ser un entero`);
    } else if (typeof v !== "string") {
      errores.push(`'${campo}.valor' debe ser un texto`);
    } else if (clave === "zocalo" && !(ZOCALOS as readonly string[]).includes(v)) {
      errores.push(`'${campo}.valor' no está en el vocabulario de zócalos`);
    } else if (clave === "curva" && !(CURVAS as readonly string[]).includes(v)) {
      errores.push(`'${campo}.valor' no está en el vocabulario de curvas`);
    } else if (clave === "medidas_mm" && !(RE_DIM.test(v) && v.split("x").every((d) => Number(d) >= DIMENSION_MM[0] && Number(d) <= DIMENSION_MM[1]))) {
      errores.push(`'${campo}.valor' debe ser AxB[xC] en milímetros`);
    }
  }
  if (tieneRango) {
    const { min, max } = m;
    const ok = (x: unknown) => x === undefined || (typeof x === "number" && numeroEnRango(clave, x));
    if (TIPOS_CLAVE[clave] !== "num") errores.push(`'${campo}' admite rango sólo en claves numéricas`);
    else if (!ok(min) || !ok(max)) errores.push(`'${campo}.min'/'max' deben ser números dentro del rango de la clave`);
    else if (typeof min === "number" && typeof max === "number" && min > max) errores.push(`'${campo}.min' no puede ser mayor que 'max'`);
  }
  if (m.dura !== undefined) {
    if (typeof m.dura !== "boolean") errores.push(`'${campo}.dura' debe ser verdadero o falso`);
    else if (m.dura && (!CLAVES_DISCRETAS_BANCO.includes(clave) || !tieneValor)) errores.push(`'${campo}.dura' sólo aplica a claves discretas (${CLAVES_DISCRETAS_BANCO.join(", ")}) con 'valor'`);
  }
  return errores;
}

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
  if (c.medidas !== undefined) {
    if (!Array.isArray(c.medidas)) mal("medidas", "debe ser una lista de medidas");
    else for (const [j, m] of c.medidas.entries()) for (const e of erroresDeMedida(m, `medidas[${j}]`)) errores.push(`caso #${i}: campo ${e}`);
  }
  if (c.sinMedidasDe !== undefined && !(Array.isArray(c.sinMedidasDe) && c.sinMedidasDe.every(esClaveDelContrato))) {
    mal("sinMedidasDe", "debe ser una lista de claves de atributos-claves.json");
  }
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
  !!(c.categoria?.length || c.atributosDuros?.length || c.expande?.length || c.debeIncluirEnTop24?.length || c.categoriaEnTop24?.length || c.sinDuros || c.intencion || c.medidas !== undefined || c.sinMedidasDe?.length);

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
