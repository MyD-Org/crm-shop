/**
 * Parser del contrato v1 CRM → Shop de cuotas configurables
 * (MyD-Org/platform contracts/cuotas/v1/schema.json). Manual a propósito: el
 * Shop no tiene zod y el shape es chico.
 *
 * Todo o nada: si algo no valida, se tira `ContratoInvalidoError` y la sync
 * conserva la última copia buena. Un payload válido vacío SÍ es válido.
 *
 * Campos desconocidos se descartan en vez de rechazar el payload: así un
 * campo aditivo del CRM no deja al Shop sin config. La salida sólo trae los
 * campos del contrato.
 */
import type { ContratoCuotasV1, MedioDePago, OpcionConfigurada } from "./pagos/cuotas-tipos";

export class ContratoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(`Contrato de cuotas v1 inválido: ${mensaje}`);
    this.name = "ContratoInvalidoError";
  }
}

type Obj = Record<string, unknown>;

const esObjeto = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function fallar(ruta: string, esperado: string): never {
  throw new ContratoInvalidoError(`${ruta} debe ser ${esperado}`);
}

function texto(o: Obj, campo: string, ruta: string): string {
  const v = o[campo];
  if (typeof v !== "string" || v.length === 0) fallar(`${ruta}.${campo}`, "string no vacío");
  return v;
}

function booleano(o: Obj, campo: string, ruta: string): boolean {
  const v = o[campo];
  if (typeof v !== "boolean") fallar(`${ruta}.${campo}`, "boolean");
  return v;
}

function entero(o: Obj, campo: string, ruta: string, min?: number, max?: number): number {
  const v = o[campo];
  if (typeof v !== "number" || !Number.isInteger(v)) fallar(`${ruta}.${campo}`, "entero");
  if ((min !== undefined && v < min) || (max !== undefined && v > max)) {
    fallar(`${ruta}.${campo}`, `entero entre ${min} y ${max}`);
  }
  return v;
}

/** YYYY-MM-DD con mes y día plausibles, o null. La clave debe existir. */
function fechaONull(o: Obj, campo: string, ruta: string): string | null {
  if (!(campo in o) || o[campo] === undefined) fallar(`${ruta}.${campo}`, "YYYY-MM-DD o null");
  const v = o[campo];
  if (v === null) return null;
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) fallar(`${ruta}.${campo}`, "YYYY-MM-DD o null");
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) fallar(`${ruta}.${campo}`, "una fecha válida");
  return v as string;
}

function lista(o: Obj, campo: string): unknown[] {
  const v = o[campo];
  if (!Array.isArray(v)) fallar(campo, "array");
  return v;
}

function medio(v: unknown, i: number): MedioDePago {
  const ruta = `medios[${i}]`;
  if (!esObjeto(v)) fallar(ruta, "objeto");
  return {
    id: texto(v, "id", ruta),
    proveedor: texto(v, "proveedor", ruta),
    codigo: texto(v, "codigo", ruta),
    nombre: texto(v, "nombre", ruta),
    activo: booleano(v, "activo", ruta),
    orden: entero(v, "orden", ruta),
  };
}

function opcion(v: unknown, i: number): OpcionConfigurada {
  const ruta = `opciones[${i}]`;
  if (!esObjeto(v)) fallar(ruta, "objeto");
  const montoMinimo = v.montoMinimo;
  if (typeof montoMinimo !== "number" || !Number.isFinite(montoMinimo) || montoMinimo < 0) {
    fallar(`${ruta}.montoMinimo`, "número ≥ 0");
  }
  return {
    id: texto(v, "id", ruta),
    medioId: texto(v, "medioId", ruta),
    cuotas: entero(v, "cuotas", ruta, 2, 24),
    sinInteres: booleano(v, "sinInteres", ruta),
    montoMinimo,
    vigenteDesde: fechaONull(v, "vigenteDesde", ruta),
    vigenteHasta: fechaONull(v, "vigenteHasta", ruta),
    activo: booleano(v, "activo", ruta),
  };
}

export function parsearContratoCuotasV1(crudo: unknown): ContratoCuotasV1 {
  if (!esObjeto(crudo)) fallar("payload", "objeto");
  if (crudo.version !== "v1") fallar("version", '"v1"');
  const tenant = texto(crudo, "tenant", "payload");
  const actualizadoEn = texto(crudo, "actualizadoEn", "payload");
  if (Number.isNaN(Date.parse(actualizadoEn))) fallar("actualizadoEn", "fecha ISO 8601");

  return {
    version: "v1",
    tenant,
    actualizadoEn,
    medios: lista(crudo, "medios").map(medio),
    opciones: lista(crudo, "opciones").map(opcion),
  };
}
