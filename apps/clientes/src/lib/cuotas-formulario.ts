/**
 * Cuotas dentro del formulario de pago (rebanada 4 de `cuotas-en-el-formulario`): lo que el
 * desplegable "Cuotas", el botón "Pagar" y el resumen lateral muestran a partir de las opciones que
 * devuelve `POST /api/pedidos/[id]/cuotas`. Puro: lo usan `SelectorCuotas`, `PagoMercadoPago` y el
 * resumen de `CheckoutClient`, que tienen que decir lo mismo (el total del botón = el del resumen).
 */
import type { CuotasRestringidas, OpcionCuotasPedido } from "./cuotas-pedido";
import { montoPorCuota } from "./cuotas-sin-interes";
import { TEXTOS_CUOTAS } from "./cuotas-textos";
import { nombreDeMarca } from "./pagos/marcas";

export type { OpcionCuotasPedido };

/** Lo elegido en el formulario, para el resumen lateral: la opción y el precio en 1 pago del pedido. */
export interface EleccionCuotas {
  opcion: OpcionCuotasPedido;
  precioUnPago: number;
}

export interface FilaSelectorCuotas {
  value: string;
  label: string;
  badge?: { label: string; tone: "success" };
}

export function etiquetaOpcion(o: OpcionCuotasPedido): string {
  return TEXTOS_CUOTAS.formularioOpcion(o.cuotas, o.montoCuota);
}

/** Una fila por opción, en orden de cuotas; el chip "Sin interés" sólo en las sin interés. */
export function filasSelectorCuotas(opciones: readonly OpcionCuotasPedido[]): FilaSelectorCuotas[] {
  return [...opciones]
    .sort((a, b) => a.cuotas - b.cuotas)
    .map((o) => ({
      value: o.clave,
      label: etiquetaOpcion(o),
      ...(o.tipo === "sin_interes" ? { badge: { label: TEXTOS_CUOTAS.sinInteres, tone: "success" as const } } : {}),
    }));
}

export function tituloCuotas(marca: { id: string | null; nombre?: string } | null): string {
  return marca?.nombre ? TEXTOS_CUOTAS.formularioTituloMarca(marca.nombre) : TEXTOS_CUOTAS.formularioTitulo;
}

/** Sólo con una cuota con interés: el CFT/TEA que informó el procesador (nada inventado) y quién financia. */
export function avisoConInteres(o: OpcionCuotasPedido, procesador: string): string | null {
  if (o.tipo !== "con_interes") return null;
  const costo = [o.cft && `CFT ${o.cft}%`, o.tea && `TEA ${o.tea}%`].filter(Boolean).join(" · ");
  return `${costo ? `${costo}. ` : ""}${TEXTOS_CUOTAS.formularioFinancia(procesador)}`;
}

/** Por qué no aparecen unas cuotas sin interés con la tarjeta cargada; agrupa las de las mismas marcas. */
export function textoRestringidas(restringidas: readonly CuotasRestringidas[]): string[] {
  const grupos = new Map<string, { cuotas: number[]; marcas: string[] }>();
  for (const r of restringidas) {
    const clave = r.marcas.join(",");
    const g = grupos.get(clave) ?? { cuotas: [], marcas: r.marcas };
    g.cuotas.push(r.cuotas);
    grupos.set(clave, g);
  }
  return [...grupos.values()].map((g) =>
    TEXTOS_CUOTAS.formularioRestringidas(
      [...g.cuotas].sort((a, b) => a - b),
      g.marcas.map(nombreDeMarca),
    ),
  );
}

/**
 * La opción elegida si sigue ofreciéndose (con los montos de la última consulta); si no (otra tarjeta,
 * o Mercado Pago cobra interés en esa cantidad), 1 pago.
 */
export function eleccionVigente(opciones: readonly OpcionCuotasPedido[], clave: string | null): OpcionCuotasPedido | undefined {
  return opciones.find((o) => o.clave === clave) ?? opciones.find((o) => o.tipo === "un_pago") ?? opciones[0];
}

/** Opción con la que arranca el desplegable: la que el pedido ya tiene congelada (N sin interés), o 1 pago. */
export function claveDelPedido(cuotasDelPedido: number | null): string | null {
  return cuotasDelPedido !== null && cuotasDelPedido > 1 ? `sin_interes-${cuotasDelPedido}` : null;
}

/** Texto del botón: `largo` en pantallas anchas, `corto` en el celular (entra en una línea). */
export function textoBotonPagar(o: OpcionCuotasPedido): { largo: string; corto: string } {
  if (o.cuotas < 2) {
    const t = TEXTOS_CUOTAS.pagar(o.total);
    return { largo: t, corto: t };
  }
  return {
    largo: TEXTOS_CUOTAS.pagarEnCuotas(o.cuotas, o.montoCuota),
    corto: TEXTOS_CUOTAS.pagarEnCuotasCorto(o.cuotas, o.montoCuota),
  };
}

export interface ResumenCuotas {
  /** Lo que paga el comprador (coincide con el botón). */
  total: number;
  /** Sólo con interés. */
  precioUnPago?: number;
  interes?: number;
  /** "6 cuotas de $X" (con interés) o "3 cuotas sin interés de $X". */
  linea?: { texto: string; sinInteres: boolean };
}

export function resumenCuotas(o: OpcionCuotasPedido, precioUnPago: number): ResumenCuotas {
  if (o.tipo === "con_interes") {
    return {
      total: o.total,
      precioUnPago,
      interes: Math.round((o.total - precioUnPago) * 100) / 100,
      linea: { texto: TEXTOS_CUOTAS.cuotasDe(o.cuotas, o.montoCuota), sinInteres: false },
    };
  }
  if (o.cuotas > 1) {
    return { total: o.total, linea: { texto: TEXTOS_CUOTAS.linea(o.cuotas, o.montoCuota), sinInteres: true } };
  }
  return { total: o.total };
}

/** El pedido tiene que pasar a otras cuotas antes de cobrar esta opción (null = 1 pago). */
export function hayQueRecongelar(pedidoCuotas: number, cuotasDelPedido: number | null): boolean {
  return pedidoCuotas !== (cuotasDelPedido ?? 1);
}

/** Sin respuesta del servidor: lo que el pedido ya tiene congelado, que el cobro acepta tal cual. */
export function opcionesDeRespaldo(actual: { cuotas: number | null; total: number }): OpcionCuotasPedido[] {
  const n = actual.cuotas ?? 1;
  if (n < 2) {
    return [{ clave: "un_pago-1", cuotas: 1, tipo: "un_pago", montoCuota: actual.total, total: actual.total, pedidoCuotas: 1 }];
  }
  return [
    {
      clave: `sin_interes-${n}`,
      cuotas: n,
      tipo: "sin_interes",
      montoCuota: montoPorCuota(actual.total, n),
      total: actual.total,
      pedidoCuotas: n,
    },
  ];
}

