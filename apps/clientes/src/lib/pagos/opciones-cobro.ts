/**
 * Opciones de cobro de un medio con cobro en línea (migración 0073 del CRM, change
 * `cuotas-en-el-formulario`, rebanada 1): qué formas de pago ofrece el checkout. Módulo PURO: lo
 * comparten el checkout (qué pestañas o modalidades mostrar) y el cobro del servidor (qué aceptar).
 *
 * Mercado Pago cobra las tres; Payway, crédito y débito (una `cuenta_mp` guardada en Payway se
 * ignora). Un conjunto vacío explícito NO es "todas": deja al medio sin cobro en línea.
 */
import { esDebito } from "./payway-estados";

export const OPCIONES_COBRO = ["credito", "debito", "cuenta_mp"] as const;
export type OpcionCobro = (typeof OPCIONES_COBRO)[number];

/** Opciones que cada procesador sabe cobrar (id del registro de `pagos/index.ts`). */
const OPCIONES_DEL_PROCESADOR: Readonly<Record<string, readonly OpcionCobro[]>> = {
  mercadopago: ["credito", "debito", "cuenta_mp"],
  payway: ["credito", "debito"],
};

/** Opciones que sabe cobrar el procesador; uno desconocido, las tres. */
export function opcionesDelProcesador(procesadorId: string): readonly OpcionCobro[] {
  return OPCIONES_DEL_PROCESADOR[procesadorId] ?? OPCIONES_COBRO;
}

/**
 * Lectura tolerante de la columna: un array se filtra a las opciones conocidas (orden canónico);
 * cualquier otra cosa da `null` (= sin dato: rigen las del procesador).
 */
export function leerOpcionesCobro(v: unknown): OpcionCobro[] | null {
  if (!Array.isArray(v)) return null;
  return OPCIONES_COBRO.filter((o) => v.includes(o));
}

/**
 * De las opciones del medio, las que su procesador puede cobrar. Sin dato (`undefined`, columna
 * ausente) = todas las del procesador; `[]` = ninguna.
 */
export function opcionesAplicables(
  procesadorId: string,
  opcionesCobro: readonly OpcionCobro[] | undefined,
): OpcionCobro[] {
  const delProcesador = opcionesDelProcesador(procesadorId);
  return opcionesCobro === undefined ? [...delProcesador] : delProcesador.filter((o) => opcionesCobro.includes(o));
}

/**
 * Qué opción usa un cobro, con lo que manda el navegador. Mercado Pago: `cuenta_mp` por el medio;
 * débito por el id del método (`deb*`, `maestro`); lo demás, incluso un id desconocido o ausente,
 * cuenta como crédito (si crédito está deshabilitado se rechaza: falla cerrado). Payway: por la
 * tabla de ids de débito.
 */
export function opcionDelCobro(datos: {
  procesadorId: string;
  medio: "tarjeta" | "cuenta_mp";
  metodoPagoId?: string;
}): OpcionCobro {
  const id = (datos.metodoPagoId ?? "").trim().toLowerCase();
  if (datos.procesadorId === "payway") {
    const n = Number(id);
    return id !== "" && Number.isInteger(n) && esDebito(n) ? "debito" : "credito";
  }
  if (datos.medio === "cuenta_mp") return "cuenta_mp";
  return id.startsWith("deb") || id === "maestro" ? "debito" : "credito";
}

/** Lectura tolerante de una forma que llega de una respuesta del servidor: la conocida o `null`. */
export function leerFormaCobro(v: unknown): OpcionCobro | null {
  return typeof v === "string" && (OPCIONES_COBRO as readonly string[]).includes(v) ? (v as OpcionCobro) : null;
}

/** ¿El medio acepta esa opción? */
export function opcionHabilitada(
  procesadorId: string,
  opcionesCobro: readonly OpcionCobro[] | undefined,
  opcion: OpcionCobro,
): boolean {
  return opcionesAplicables(procesadorId, opcionesCobro).includes(opcion);
}
