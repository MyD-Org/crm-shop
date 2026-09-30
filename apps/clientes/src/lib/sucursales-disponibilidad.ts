/**
 * Disponibilidad de un producto por sucursal (change `sucursales-igz-mdp`, rebanada B, lote 1).
 *
 * Módulo PURO (sin DB, reloj ni Next): recibe el stock bruto y lo reservado por sucursal como
 * DATOS y devuelve, por producto, qué se puede prometer al cliente para envío y para retiro en
 * cada local. Reusa `origenDeLinea` de `sucursales.ts`, la misma regla que usa `asignarSucursal`
 * al crear el pedido: lo que la UI promete y lo que el checkout asigna no pueden divergir.
 *
 * La falta de stock NUNCA oculta un producto: sólo cambia el estado (`a_traer`, `con_demora`,
 * `sin_stock`). Lo que oculta es el ocultamiento explícito por sucursal (`ocultoEn`).
 * Todavía sin consumidores: el lote 2 lo cablea a catálogo, ficha y carrito, detrás del flag
 * `disponibilidad-sucursal`.
 */
import { origenDeLinea, type ReglasVenta, type SucursalDato } from "./sucursales";

/** Por producto: stock por sucursal; `null` en el producto = no inventariable. */
export type StockPorSucursal = Record<string, Record<string, number> | null>;

export interface EntradaDisponibilidad {
  /** Stock BRUTO por producto y sucursal. Sucursal ausente de un inventariable = 0. */
  stockPorSucursal: StockPorSucursal;
  /** Unidades reservadas (vista `stock_reservado_sucursal`) por producto y sucursal. */
  reservadoPorSucursal: Record<string, Record<string, number>>;
  /** `oculto_en_sucursales` por producto; ausente = visible en todas. */
  ocultoEn: Record<string, string[]>;
  sucursales: SucursalDato[];
  /** Sucursal de la zona vigente del cliente (la que despacharía el envío). */
  zona: string;
  /** Sólo se calcula el bloque de la modalidad pedida. */
  modalidad: "envio" | "retiro";
  reglas: ReglasVenta;
  /** Unidades que se quieren por producto; por defecto 1. */
  cantidades?: Record<string, number>;
}

export type EstadoEnvio = "disponible" | "a_traer" | "sin_stock" | "no_servible";
export type EstadoRetiro = "disponible" | "con_demora" | "sin_stock" | "oculto";

export interface DisponibilidadEnvio {
  estado: EstadoEnvio;
  /** Sucursal de la que sale el producto (origen, o respaldo si `a_traer`); null sin origen. */
  origen: string | null;
  /** Demora de traslado si es `a_traer`; 0 = "a coordinar"; null si no hay traslado. */
  demoraDias: number | null;
}

export interface DisponibilidadRetiro {
  estado: EstadoRetiro;
  /** De dónde se trae si es `con_demora`; null si no. */
  desde: string | null;
  /** Demora si es `con_demora`; 0 = "a coordinar"; null si no hay traslado. */
  demoraDias: number | null;
}

export interface DisponibilidadProducto {
  /** null si la modalidad pedida es `retiro`. */
  envio: DisponibilidadEnvio | null;
  /** Un ítem por local que acepta retiro (activo); null si la modalidad pedida es `envio`. */
  retiro: Record<string, DisponibilidadRetiro> | null;
  /** ¿Alguna sucursal activa lo sirve? (falso = oculto en todas: el catálogo no lo muestra). */
  servible: boolean;
}

export interface ResultadoDisponibilidad {
  productos: Record<string, DisponibilidadProducto>;
  /** Ids con envío `a_traer` (para el `lineasATraer` del pedido). Vacío en modalidad `retiro`. */
  lineasATraer: string[];
}

/** Disponible neto de reserva; `null` = no inventariable. Nunca negativo. */
export function disponibleNeto(
  stock: Record<string, number> | null | undefined,
  reservado: Record<string, number> | undefined,
  sucursal: string,
): number | null {
  if (stock === null) return null;
  return Math.max(0, (stock?.[sucursal] ?? 0) - (reservado?.[sucursal] ?? 0));
}

export function disponibilidadPorSucursal(entrada: EntradaDisponibilidad): ResultadoDisponibilidad {
  const { sucursales, zona, modalidad, reglas } = entrada;
  const ids = new Set([
    ...Object.keys(entrada.stockPorSucursal),
    ...Object.keys(entrada.ocultoEn),
    ...Object.keys(entrada.reservadoPorSucursal),
  ]);
  const locales = sucursales
    .filter((s) => s.activa && s.aceptaRetiro)
    .sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug));

  const productos: Record<string, DisponibilidadProducto> = {};
  const lineasATraer: string[] = [];

  for (const id of [...ids].sort()) {
    const linea = { id, qty: entrada.cantidades?.[id] ?? 1, ocultoEn: entrada.ocultoEn[id] ?? [] };
    const stock = (sucursal: string, i: string) =>
      disponibleNeto(entrada.stockPorSucursal[i], entrada.reservadoPorSucursal[i], sucursal);
    const servible = sucursales.some((s) => s.activa && !linea.ocultoEn.includes(s.slug));

    let envio: DisponibilidadEnvio | null = null;
    if (modalidad === "envio") {
      const r = origenDeLinea(linea, zona, sucursales, stock);
      if ("error" in r) {
        envio = { estado: r.error, origen: null, demoraDias: null };
      } else if (r.aTraer) {
        envio = { estado: "a_traer", origen: r.origen, demoraDias: reglas.trasladoDias };
        lineasATraer.push(id);
      } else {
        envio = { estado: "disponible", origen: r.origen, demoraDias: null };
      }
    }

    let retiro: Record<string, DisponibilidadRetiro> | null = null;
    if (modalidad === "retiro") {
      retiro = {};
      for (const local of locales) {
        if (linea.ocultoEn.includes(local.slug)) {
          retiro[local.slug] = { estado: "oculto", desde: null, demoraDias: null };
          continue;
        }
        const r = origenDeLinea(linea, local.slug, sucursales, stock);
        if ("error" in r) retiro[local.slug] = { estado: "sin_stock", desde: null, demoraDias: null };
        else if (r.aTraer)
          retiro[local.slug] = { estado: "con_demora", desde: r.origen, demoraDias: reglas.trasladoDias };
        else retiro[local.slug] = { estado: "disponible", desde: null, demoraDias: null };
      }
    }

    productos[id] = { envio, retiro, servible };
  }
  return { productos, lineasATraer };
}
