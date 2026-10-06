/**
 * Control de fraude (Cybersource, vertical Retail) de Payway: arma el bloque `fraud_detection` de
 * `POST /payments`. Módulo PURO: sin red, sin env, sin DB. Todo sale del pedido ya congelado y del
 * comprador autenticado del servidor; del navegador NO viene nada de acá.
 *
 * Fuente: documentación oficial de Payway (SDK PHP, sección "Integración con Cybersource > Retail") y el
 * código del SDK (`Decidir/lib/Cybersource/Retail.php`), que define la forma exacta del JSON:
 *
 *   fraud_detection: {
 *     send_to_cs, channel,
 *     bill_to: { city, country, customer_id, email, first_name, last_name, phone_number, postal_code, state, street1 },
 *     purchase_totals: { currency, amount },
 *     customer_in_site: { days_in_site?, is_guest },
 *     retail_transaction_data: { ship_to: {...}, tax_voucher_required, items: [{ code, description, name, sku, total_amount, quantity, unit_price }] }
 *   }
 *
 * Importes: `amount`, `total_amount` y `unit_price` van en CENTAVOS enteros (la SDK multiplica por 100).
 *
 * El `device_unique_identifier` NO va acá: lo genera el SDK del navegador y viaja en el request de
 * tokenización (`fraud_detection.device_unique_identifier`), de donde Payway lo asocia al pago por el token.
 * La IP del comprador tampoco: la documentación sólo la prevé en el request del token.
 *
 * Datos que el pedido NO guarda (provincia y código postal de la entrega) llevan un valor neutro y
 * documentado (`NEUTROS`), nunca inventado por comprador. Nunca se loguea el resultado (datos personales).
 */

import type { DatosAntifraude } from "./tipos";
import { centavos } from "./payway-estados";

/** Valores neutros para lo que el pedido no guarda. Se mandan tal cual, iguales para todos. */
export const NEUTROS = {
  /** Provincia: "BA" (el valor de la documentación). El pedido sólo guarda la ciudad de entrega. */
  state: "BA",
  /** Código postal: el pedido no lo guarda. */
  postal_code: "1000",
  city: "Buenos Aires",
  street: "Sin domicilio informado",
  phone: "0000000000",
  apellido: "Cliente",
  nombre: "Cliente",
} as const;

export interface DomicilioCs {
  city: string;
  country: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  postal_code: string;
  state: string;
  street1: string;
}

export interface ItemCs {
  code: string;
  description: string;
  name: string;
  sku: string;
  total_amount: number;
  quantity: number;
  unit_price: number;
}

export interface FraudDetection {
  send_to_cs: true;
  channel: "Web";
  bill_to: DomicilioCs & { customer_id: string };
  purchase_totals: { currency: "ARS"; amount: number };
  customer_in_site: { is_guest: boolean; days_in_site?: number };
  retail_transaction_data: {
    ship_to: DomicilioCs;
    tax_voucher_required: boolean;
    items: ItemCs[];
  };
}

/** Sin acentos ni caracteres especiales: sólo letras, números y espacios (lo que piden nombres y ciudad). */
function soloAlfanumerico(s: string | null | undefined, max: number): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** Domicilio: sin acentos, conserva puntuación habitual de las calles. */
function domicilio(s: string | null | undefined, max: number): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,\-/#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** "Juan Carlos Pérez" -> nombre "Juan", apellido "Carlos Perez". Una sola palabra -> apellido neutro. */
export function partirNombre(completo: string | null | undefined): { nombre: string; apellido: string } {
  const partes = soloAlfanumerico(completo, 120).split(" ").filter(Boolean);
  if (partes.length === 0) return { nombre: NEUTROS.nombre, apellido: NEUTROS.apellido };
  if (partes.length === 1) return { nombre: partes[0].slice(0, 60), apellido: NEUTROS.apellido };
  return { nombre: partes[0].slice(0, 60), apellido: partes.slice(1).join(" ").slice(0, 60) };
}

/** Sólo dígitos, máximo 15 (los últimos). Sin dígitos suficientes, el neutro. */
export function limpiarTelefono(t: string | null | undefined): string {
  const d = String(t ?? "").replace(/\D/g, "");
  return d.length >= 6 ? d.slice(-15) : NEUTROS.phone;
}

/** Ciudad: debe empezar con una letra. */
function ciudad(c: string | null | undefined): string {
  const limpia = soloAlfanumerico(c, 50).replace(/^[^A-Za-z]+/, "");
  return limpia || NEUTROS.city;
}

function item(i: DatosAntifraude["items"][number]): ItemCs {
  const total = centavos(i.total);
  const entera = Number.isInteger(i.cantidad) && i.cantidad >= 1;
  // Cantidad fraccionaria (metros, kilos): un renglón por el total, así total = unitario × cantidad cierra.
  const quantity = entera ? i.cantidad : 1;
  const nombre = domicilio(i.nombre, 255) || "Producto";
  return {
    code: "default",
    description: nombre,
    name: nombre,
    sku: domicilio(i.sku, 255) || "sin-sku",
    total_amount: total,
    quantity,
    unit_price: Math.round(total / quantity),
  };
}

/**
 * `fraud_detection` de un pedido. Tira `Error` si falta lo que no tiene valor neutro (el correo, el
 * identificador del comprador o el monto): la ruta lo traduce a un corte sin cobro.
 */
export function armarFraudDetection(d: DatosAntifraude, monto: number): FraudDetection {
  const email = String(d.email ?? "").trim().slice(0, 100);
  if (!email) throw new Error("Falta el correo del comprador.");
  const customerId = String(d.clienteId ?? "").trim().slice(0, 50);
  if (!customerId) throw new Error("Falta el identificador del comprador.");
  if (d.items.length === 0) throw new Error("El pedido no tiene productos.");

  const { nombre, apellido } = partirNombre(d.nombre);
  const phone_number = limpiarTelefono(d.telefono);
  const aDomicilio = d.entrega.tipo === "envio";

  const facturacion = domicilio(d.facturacionDomicilio, 60);
  const entregaCalle = domicilio(d.entrega.direccion, 60);
  const ciudadEntrega = ciudad(d.entrega.ciudad);

  const base = { country: "AR", email, first_name: nombre, last_name: apellido, phone_number };
  const bill: DomicilioCs = {
    ...base,
    city: ciudadEntrega,
    postal_code: NEUTROS.postal_code,
    state: NEUTROS.state,
    street1: facturacion || entregaCalle || NEUTROS.street,
  };
  // Retiro en local: la documentación pide replicar los datos de facturación, nunca el domicilio del comercio.
  const ship: DomicilioCs = aDomicilio ? { ...bill, street1: entregaCalle || bill.street1 } : { ...bill };

  return {
    send_to_cs: true,
    channel: "Web",
    bill_to: { ...bill, customer_id: customerId },
    purchase_totals: { currency: "ARS", amount: centavos(monto) },
    customer_in_site: {
      is_guest: false,
      ...(d.diasEnSitio !== undefined && Number.isInteger(d.diasEnSitio) && d.diasEnSitio >= 0
        ? { days_in_site: d.diasEnSitio }
        : {}),
    },
    retail_transaction_data: {
      ship_to: ship,
      tax_voucher_required: true,
      items: d.items.map(item),
    },
  };
}
