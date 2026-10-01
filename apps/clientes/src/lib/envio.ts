/**
 * Reglas de entrega (change `envio-gratis-configurable`).
 *
 * Módulo PURO a propósito: no importa la DB ni Alegra, así el checkout (client
 * component) y la validación del servidor comparten exactamente las mismas
 * reglas. Duplicarlas en el cliente y en el servidor es cómo se termina
 * mostrando "envío gratis" y rechazando el pedido dos pantallas después.
 *
 * La configuración (envío a domicilio activo, envío gratis con alcance y mínimo)
 * vive en el CRM (`public.reglas_venta`) y llega INYECTADA como `ConfigEnvio`:
 * este módulo no sabe de dónde sale.
 */
import { PROVINCIAS_AR } from "./provincias";
import { claveProvincia } from "./sucursales";
import { fmtPesosEnteros } from "./format";

export type EntregaTipo = "retiro" | "envio";
export type PagoMetodo =
  | "transferencia"
  | "efectivo"
  | "cuenta_corriente"
  | "mercadopago"
  // Sin medio de pago: un asesor lo coordina después de confirmado el pedido.
  // Es el único método válido cuando ningún medio de `medios_pago_shop` aplica a la entrega.
  | "a_coordinar";

export const ENTREGA_LABEL: Record<EntregaTipo, string> = {
  retiro: "Retiro en local",
  envio: "Envío a domicilio",
};

/**
 * Etiqueta del envío que se coordina con un asesor (sin ciudad ni dirección).
 * SÓLO para pedidos viejos: desde `envio-gratis-configurable` el checkout ya no
 * ofrece "Envío a coordinar" aparte (se fusionó con el envío a domicilio, cuyo
 * costo se coordina cuando no es gratis), pero los pedidos creados antes lo
 * conservan y se siguen rotulando así.
 */
export const ENVIO_A_COORDINAR_LABEL = "Envío a coordinar";

/**
 * "Envío a coordinar" (pedido viejo) es un `envio` sin ciudad ni dirección: un
 * asesor acordó con el cliente el destino y el costo. Sólo para rotular pedidos
 * ya creados; los nuevos siempre llevan dirección.
 */
export function esEnvioACoordinar(
  tipo: string,
  ciudad: string | null | undefined,
  direccion: string | null | undefined,
): boolean {
  return tipo === "envio" && !ciudad?.trim() && !direccion?.trim();
}

/** Etiqueta de la entrega de un pedido ya creado, distinguiendo el envío a coordinar. */
export function etiquetaEntrega(
  tipo: string,
  ciudad?: string | null,
  direccion?: string | null,
): string {
  if (esEnvioACoordinar(tipo, ciudad, direccion)) return ENVIO_A_COORDINAR_LABEL;
  return ENTREGA_LABEL[tipo as EntregaTipo] ?? tipo;
}

export const PAGO_LABEL: Record<PagoMetodo, string> = {
  transferencia: "Transferencia bancaria",
  efectivo: "Efectivo en el local",
  cuenta_corriente: "Cuenta corriente",
  mercadopago: "Tarjeta o Mercado Pago",
  a_coordinar: "A coordinar con un asesor",
};

/**
 * Configuración del envío tal como la guarda el CRM. `gratis` es null si el envío gratis
 * está apagado o sin configurar por completo (nunca "vacío = todo").
 */
export interface ConfigEnvio {
  /** ¿Se ofrece el envío a domicilio? */
  domicilioActivo: boolean;
  gratis: null | {
    alcance: "pais" | "provincias";
    /** Claves de provincia (`claveProvincia`); sólo cuentan con alcance `provincias`. */
    provincias: string[];
    /** Sin impuestos; null = sin mínimo. */
    minimo: number | null;
  };
}

/**
 * Lo que rige sin fila en `reglas_venta` o si la lectura falla: envío a domicilio activo con
 * costo a coordinar y envío gratis apagado (igual que lo que deja la migración del CRM).
 */
export const CONFIG_ENVIO_DEFAULT: ConfigEnvio = { domicilioActivo: true, gratis: null };

export type MotivoEnvio =
  | "inactivo"
  | "gratis_apagado"
  | "sin_ubicacion"
  | "fuera_de_alcance"
  | "bajo_minimo";

export interface EnvioEvaluado {
  /** ¿Se puede elegir envío a domicilio? */
  disponible: boolean;
  gratis: boolean;
  /** Disponible pero con costo a coordinar con el comercio. */
  aCoordinar: boolean;
  motivo: MotivoEnvio | null;
  /** Lo que falta para el envío gratis (sin impuestos); 0 si no aplica. */
  faltante: number;
}

/**
 * Evalúa el envío a domicilio. Gratis = domicilio activo Y gratis activo Y provincia en el
 * alcance Y subtotal (sin impuestos) >= mínimo. Activo pero no gratis: disponible con costo a
 * coordinar. Provincia desconocida: nunca gratis. `provincia` admite cualquier grafía (se
 * normaliza con `claveProvincia`).
 */
export function evaluarEnvio(
  subtotalSinIva: number,
  provincia: string | null | undefined,
  config: ConfigEnvio,
): EnvioEvaluado {
  const aCoordinar = (motivo: MotivoEnvio, faltante = 0): EnvioEvaluado => ({
    disponible: true,
    gratis: false,
    aCoordinar: true,
    motivo,
    faltante,
  });
  if (!config.domicilioActivo) {
    return { disponible: false, gratis: false, aCoordinar: false, motivo: "inactivo", faltante: 0 };
  }
  const g = config.gratis;
  if (!g) return aCoordinar("gratis_apagado");
  if (g.alcance === "provincias") {
    const clave = claveProvincia(provincia);
    if (!clave) return aCoordinar("sin_ubicacion");
    if (!g.provincias.includes(clave)) return aCoordinar("fuera_de_alcance");
  }
  if (g.minimo !== null && subtotalSinIva < g.minimo) {
    return aCoordinar("bajo_minimo", g.minimo - subtotalSinIva);
  }
  return { disponible: true, gratis: true, aCoordinar: false, motivo: null, faltante: 0 };
}

function listar(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** El nombre de una provincia a partir de su clave (o la clave si no se reconoce). */
export function nombreProvincia(clave: string): string {
  return PROVINCIAS_AR.find((p) => claveProvincia(p) === clave) ?? clave;
}

/**
 * Texto de la regla de envío, generado desde la configuración (nada de listas fijas): lo usan
 * Envíos y pagos, Mi cuenta y la ficha.
 */
export function textoRegla(config: ConfigEnvio): string {
  if (!config.domicilioActivo) return "El envío a domicilio no está disponible por el momento.";
  const g = config.gratis;
  if (!g || (g.alcance === "provincias" && g.provincias.length === 0)) {
    return "El envío a domicilio tiene costo a coordinar.";
  }
  const donde = g.alcance === "pais" ? "todo el país" : listar(g.provincias.map(nombreProvincia));
  const minimo =
    g.minimo === null
      ? ""
      : `, en compras desde ${fmtPesosEnteros(g.minimo)} sin impuestos`;
  return `El envío a domicilio es gratis en ${donde}${minimo}; en los demás casos, el costo de envío es a coordinar con el comercio.`;
}

/**
 * Barra "Le faltan $X para el envío gratis" del carrito. null = no se muestra: envío inactivo,
 * gratis apagado, sin mínimo, o la provincia (desconocida o fuera de alcance) no permite
 * prometer nada. `alcanzado` = ya califica (se muestra el estado "tiene envío gratis").
 */
export function progresoEnvioGratis(
  subtotalSinIva: number | null,
  provincia: string | null | undefined,
  config: ConfigEnvio,
): { faltante: number; pct: number; alcanzado: boolean } | null {
  const minimo = config.gratis?.minimo ?? null;
  if (subtotalSinIva === null || minimo === null) return null;
  const e = evaluarEnvio(subtotalSinIva, provincia, config);
  if (!e.gratis && e.motivo !== "bajo_minimo") return null;
  return {
    faltante: e.faltante,
    pct: Math.min(100, Math.floor((subtotalSinIva / minimo) * 100)),
    alcanzado: e.gratis,
  };
}

/**
 * Texto de la fila "Envío a domicilio" de la ficha del producto. null = sin fila (envío inactivo).
 * `provincia` es la del visitante si se conoce (clave o nombre); `localidad` sólo adorna el
 * "Gratis a <localidad>". Sin provincia y con alcance por provincias se muestra la regla general,
 * sin pedir un dato que el visitante todavía no puede dar.
 */
export function textoEnvioFicha(
  config: ConfigEnvio,
  provincia?: string | null,
  localidad?: string | null,
): string | null {
  if (!config.domicilioActivo) return null;
  const g = config.gratis;
  const sinGratis = "Costo de envío a coordinar";
  if (!g || (g.alcance === "provincias" && g.provincias.length === 0)) return sinGratis;
  const minimo = g.minimo === null ? null : `${fmtPesosEnteros(g.minimo)} sin impuestos`;
  if (g.alcance === "provincias") {
    const clave = claveProvincia(provincia);
    if (!clave) {
      const donde = listar(g.provincias.map(nombreProvincia));
      return `Gratis en ${donde}${minimo ? ` desde ${minimo}` : ""} · si no, costo de envío a coordinar`;
    }
    if (!g.provincias.includes(clave)) return sinGratis;
  }
  if (minimo) return `Gratis desde ${minimo} · si no, costo a coordinar`;
  return localidad ? `Gratis a ${localidad}` : "Envío gratis";
}

/** Costo del envío online. Siempre 0: si es gratis no se cobra y si no, el costo se coordina fuera de línea. */
export function costoEnvio(): 0 {
  return 0;
}
