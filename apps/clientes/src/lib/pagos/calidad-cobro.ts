/**
 * Datos opcionales del cobro con tarjeta que ayudan al procesador a aprobar más pagos (emisor, id de
 * dispositivo, líneas, comprador y entrega). Puro, sin red ni base. Nada de esto decide qué se cobra:
 * monto, cuenta y cuotas salen del pedido persistido (ver `cobrar.ts`).
 */

import type { InfoAdicionalPago } from "./tipos";

/** Mercado Pago no valida la suma de las líneas: con un pedido muy largo se informan las primeras. */
export const MAX_ITEMS_INFO = 50;
const MAX_TEXTO = 250;

const recortar = (v: string | null | undefined) => (v ?? "").trim().slice(0, MAX_TEXTO);
const dosDecimales = (n: number) => Math.round(n * 100) / 100;

/** Emisor de la tarjeta que manda el navegador (string o número): sólo dígitos, máx. 20. */
export function sanearIssuerId(v: unknown): string | undefined {
  const s = typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : typeof v === "string" ? v.trim() : "";
  return /^\d{1,20}$/.test(s) ? s : undefined;
}

/**
 * Id de dispositivo que manda el navegador. Viaja en un header: sólo letras, dígitos, `.`, `_` y `-`
 * (los ids de Mercado Pago llevan un prefijo separado por punto), máx. 100.
 */
export function sanearDeviceId(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return /^[A-Za-z0-9._-]{1,100}$/.test(s) ? s : undefined;
}

interface PedidoParaInfo {
  contactoNombre?: string | null;
  entregaTipo?: string | null;
  entregaCiudad?: string | null;
  entregaDireccion?: string | null;
}

/** `total` = total de la línea en pesos, con IVA (como `getItemsParaAntifraude`). */
type LineaPedido = { sku: string; nombre: string; cantidad: number; total: number };

/**
 * Arma los datos adicionales desde el pedido congelado. El precio unitario es el total de la línea
 * dividido por la cantidad; una cantidad fraccionaria (metros de cable) se informa como 1 unidad por el
 * total de la línea. El nombre de contacto se parte en el primer espacio. Sin nada que informar, undefined.
 */
export function infoAdicionalDelPedido(
  pedido: PedidoParaInfo,
  lineas: readonly LineaPedido[] | null | undefined,
): InfoAdicionalPago | undefined {
  const items = (lineas ?? [])
    .filter((l) => Number.isFinite(l.total) && l.total >= 0 && Number.isFinite(l.cantidad) && l.cantidad > 0)
    .slice(0, MAX_ITEMS_INFO)
    .map((l) => {
      const entera = Number.isInteger(l.cantidad);
      return {
        id: recortar(l.sku),
        titulo: recortar(l.nombre),
        cantidad: entera ? l.cantidad : 1,
        precioUnitario: dosDecimales(entera ? l.total / l.cantidad : l.total),
      };
    });

  const contacto = recortar(pedido.contactoNombre).replace(/\s+/g, " ");
  const corte = contacto.indexOf(" ");
  const nombre = corte === -1 ? contacto : contacto.slice(0, corte);
  const apellido = corte === -1 ? "" : contacto.slice(corte + 1);

  const direccion = pedido.entregaTipo === "envio" ? recortar(pedido.entregaDireccion) : "";
  const ciudad = recortar(pedido.entregaCiudad);

  if (items.length === 0 && !nombre && !direccion) return undefined;
  return {
    items,
    ...(nombre ? { nombre } : {}),
    ...(apellido ? { apellido } : {}),
    ...(direccion ? { envio: { direccion, ...(ciudad ? { ciudad } : {}) } } : {}),
  };
}
