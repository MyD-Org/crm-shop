/**
 * Parser del contrato v2 CRM → Shop de cuotas (config por proveedor)
 * (MyD-Org/platform contracts/cuotas/v2). Manual a propósito: el Shop no tiene
 * zod y el shape es chico.
 *
 * Todo o nada: si algo no valida (incluida otra versión, p. ej. una caché v1),
 * se tira `ContratoInvalidoError` y la sync conserva la última copia buena. Un
 * payload válido vacío SÍ es válido.
 *
 * Campos desconocidos se descartan en vez de rechazar el payload: así un campo
 * aditivo del CRM no deja al Shop sin config. La salida sólo trae los campos
 * del contrato.
 */
import type { ContratoCuotasV2, EscalonCuotas, ProveedorConfigurado } from "./pagos/cuotas-tipos";

export class ContratoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(`Contrato de cuotas v2 inválido: ${mensaje}`);
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

function lista(o: Obj, campo: string, ruta: string): unknown[] {
  const v = o[campo];
  if (!Array.isArray(v)) fallar(ruta ? `${ruta}.${campo}` : campo, "array");
  return v;
}

function escalon(v: unknown, ruta: string): EscalonCuotas {
  if (!esObjeto(v)) fallar(ruta, "objeto");
  const montoMinimo = v.montoMinimo;
  if (typeof montoMinimo !== "number" || !Number.isFinite(montoMinimo) || montoMinimo < 0) {
    fallar(`${ruta}.montoMinimo`, "número ≥ 0");
  }
  return {
    id: texto(v, "id", ruta),
    cuotasMax: entero(v, "cuotasMax", ruta, 1, 24),
    montoMinimo,
  };
}

function proveedor(v: unknown, i: number): ProveedorConfigurado {
  const ruta = `proveedores[${i}]`;
  if (!esObjeto(v)) fallar(ruta, "objeto");
  const base = {
    id: texto(v, "id", ruta),
    proveedor: texto(v, "proveedor", ruta),
    nombre: texto(v, "nombre", ruta),
    activo: booleano(v, "activo", ruta),
    orden: entero(v, "orden", ruta),
  };
  const escalones = lista(v, "escalones", ruta)
    .map((e, j) => escalon(e, `${ruta}.escalones[${j}]`))
    // El CRM ya los manda ordenados; se reordena por defensa (sort estable).
    .sort((a, b) => a.montoMinimo - b.montoMinimo);
  return { ...base, escalones };
}

export function parsearContratoCuotasV2(crudo: unknown): ContratoCuotasV2 {
  if (!esObjeto(crudo)) fallar("payload", "objeto");
  if (crudo.version !== "v2") fallar("version", '"v2"');
  const tenant = texto(crudo, "tenant", "payload");
  const actualizadoEn = texto(crudo, "actualizadoEn", "payload");
  if (Number.isNaN(Date.parse(actualizadoEn))) fallar("actualizadoEn", "fecha ISO 8601");

  return {
    version: "v2",
    tenant,
    actualizadoEn,
    proveedores: lista(crudo, "proveedores", "").map(proveedor),
  };
}
