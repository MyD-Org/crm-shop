/**
 * Validaciones y armado de datos de la tarjeta para el formulario de Payway. Módulo PURO: sin red,
 * sin env, sin DOM. Lo importa el componente del navegador (`PagoPayway.tsx`).
 *
 * Son controles de comodidad para que el comprador corrija un error de tipeo antes de tokenizar; no
 * sustituyen a Payway, que valida de nuevo. Los mensajes son en usted.
 *
 * Nada de acá se loguea ni se guarda: el número y el código de seguridad sólo viven en el estado del
 * formulario hasta que se tokeniza.
 */

import { idMedioPago, type ModalidadTarjeta } from "./payway-estados";

export type { ModalidadTarjeta };

/** Marcas con id en la tabla oficial de Payway (ver `payway-estados.ts`). */
export type Marca = "visa" | "mastercard" | "maestro" | "amex" | "cabal" | "naranja" | "diners";

export const MARCAS: ReadonlyArray<{ id: Marca; etiqueta: string }> = [
  { id: "visa", etiqueta: "Visa" },
  { id: "mastercard", etiqueta: "Mastercard" },
  { id: "maestro", etiqueta: "Maestro" },
  { id: "amex", etiqueta: "American Express" },
  { id: "cabal", etiqueta: "Cabal" },
  { id: "naranja", etiqueta: "Naranja" },
  { id: "diners", etiqueta: "Diners" },
];

export type Validacion = { ok: true } | { ok: false; mensaje: string };
const OK: Validacion = { ok: true };
const error = (mensaje: string): Validacion => ({ ok: false, mensaje });

export const normalizarPan = (s: string): string => String(s ?? "").replace(/[\s-]/g, "");
const soloDigitos = (s: string): string => String(s ?? "").replace(/\D/g, "");

/**
 * Sugerencia de marca por el prefijo del número. Es sólo una ayuda: el comprador la puede cambiar
 * (Naranja o Cabal comparten rangos con otras). No hay consulta de BIN en la API de Payway.
 */
export function marcaPorPrefijo(pan: string): Marca | null {
  const p = normalizarPan(pan);
  if (p.length < 2) return null;
  const n2 = Number(p.slice(0, 2));
  const n3 = Number(p.slice(0, 3));
  const n4 = Number(p.slice(0, 4));
  const n6 = Number(p.slice(0, 6));

  if (n6 === 589562) return "naranja";
  if (n6 === 589657 || (p.length >= 3 && p.startsWith("604")) || n6 === 627170) return "cabal";
  if (n2 === 34 || n2 === 37) return "amex";
  if (n2 === 36 || n2 === 38 || (n3 >= 300 && n3 <= 305)) return "diners";
  // Maestro antes que Mastercard: 50, 56-58 y 6x, salvo lo que ya cayó en Cabal/Naranja.
  if (n2 === 50 || (n2 >= 56 && n2 <= 58) || p.startsWith("63") || p.startsWith("67")) return "maestro";
  if ((n2 >= 51 && n2 <= 55) || (n4 >= 2221 && n4 <= 2720)) return "mastercard";
  if (p.startsWith("4")) return "visa";
  return null;
}

function luhn(digitos: string): boolean {
  let suma = 0;
  let doble = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = digitos.charCodeAt(i) - 48;
    if (doble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
    doble = !doble;
  }
  return suma % 10 === 0;
}

/** Largos válidos por marca (Payway: Visa/MC 16, Amex 15, Diners 14, Maestro hasta 19). */
const LARGOS: Record<Marca, readonly number[]> = {
  visa: [16],
  mastercard: [16],
  maestro: [12, 13, 14, 15, 16, 17, 18, 19],
  amex: [15],
  cabal: [16],
  naranja: [16],
  diners: [14, 16],
};

const MSJ_PAN = "Revise el número de la tarjeta.";

export function validarPan(pan: string, marca: Marca | null): Validacion {
  const p = normalizarPan(pan);
  if (!p) return error("Ingrese el número de la tarjeta.");
  if (!/^\d{13,19}$/.test(p)) return error(MSJ_PAN);
  if (marca && !LARGOS[marca].includes(p.length)) return error(MSJ_PAN);
  if (!luhn(p)) return error(MSJ_PAN);
  return OK;
}

/** Mes (1-2 dígitos) y año (2 o 4 dígitos). Vale hasta el último día del mes de vencimiento. */
export function validarVencimiento(mes: string, anio: string, ahora: Date = new Date()): Validacion {
  const m = soloDigitos(mes);
  const a = soloDigitos(anio);
  const MSJ = "Revise la fecha de vencimiento (MM/AA).";
  if (!/^\d{1,2}$/.test(m) || !(a.length === 2 || a.length === 4)) return error(MSJ);
  const mesN = Number(m);
  if (mesN < 1 || mesN > 12) return error(MSJ);
  const anioN = a.length === 2 ? 2000 + Number(a) : Number(a);
  const actual = ahora.getFullYear() * 12 + ahora.getMonth();
  if (anioN * 12 + (mesN - 1) < actual) return error("La tarjeta está vencida. Use otra.");
  return OK;
}

export function validarCvv(cvv: string, marca: Marca | null): Validacion {
  const c = String(cvv ?? "");
  const MSJ = "Revise el código de seguridad.";
  if (!/^\d+$/.test(c)) return error(c ? MSJ : "Ingrese el código de seguridad.");
  if (marca === "amex") return c.length === 4 ? OK : error("American Express usa un código de 4 dígitos.");
  if (marca) return c.length === 3 ? OK : error(MSJ);
  return c.length === 3 || c.length === 4 ? OK : error(MSJ);
}

export function validarTitular(nombre: string): Validacion {
  const n = String(nombre ?? "").trim();
  if (!n) return error("Ingrese el nombre del titular, como figura en la tarjeta.");
  if (n.length > 60) return error("El nombre del titular es demasiado largo.");
  return OK;
}

/** Sólo DNI: es el único tipo que documenta Payway. */
export function validarDocumento(nro: string): Validacion {
  const d = soloDigitos(nro);
  if (!d) return error("Ingrese el DNI del titular.");
  if (!/^\d{7,8}$/.test(d)) return error("Revise el DNI del titular.");
  return OK;
}

/** `payment_method_id` de Payway para esa marca y modalidad; null si no existe esa combinación. */
export function metodoPagoIdDe(marca: string | null, modalidad: ModalidadTarjeta): number | null {
  return marca ? idMedioPago(marca, modalidad) : null;
}

/** El débito se cobra en un pago: Payway no lo admite en cuotas. */
export function cuotasPermitidas(modalidad: ModalidadTarjeta, cuotas: number): boolean {
  return modalidad === "debito" ? cuotas === 1 : cuotas >= 1;
}

export interface DatosTarjeta {
  pan: string;
  mes: string;
  anio: string;
  cvv: string;
  titular: string;
  nroDoc: string;
}

/** Cuerpo de `POST /tokens` (modelo NO PCI de Payway). Mes "MM", año "YY". */
export interface SolicitudToken {
  card_number: string;
  security_code: string;
  card_holder_name: string;
  card_expiration_month: string;
  card_expiration_year: string;
  card_holder_identification: { type: "dni"; number: string };
}

export function armarSolicitudToken(d: DatosTarjeta): SolicitudToken {
  const anio = soloDigitos(d.anio);
  return {
    card_number: normalizarPan(d.pan),
    security_code: String(d.cvv).trim(),
    card_holder_name: String(d.titular).trim(),
    card_expiration_month: soloDigitos(d.mes).padStart(2, "0"),
    card_expiration_year: anio.length === 4 ? anio.slice(2) : anio,
    card_holder_identification: { type: "dni", number: soloDigitos(d.nroDoc) },
  };
}
