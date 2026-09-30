/**
 * Zona y asignación de sucursal (change `sucursales-igz-mdp`, rebanada A).
 *
 * Módulo PURO a propósito (patrón de `envio.ts`): no importa la DB, el reloj ni Next. Recibe las
 * reglas como DATOS (leídas de `public.sucursales` / `public.zonas` por el contrato CRM -> Shop) y
 * devuelve la sucursal y la regla que se congela en el pedido. Mismas reglas + misma entrada =
 * mismo resultado, siempre.
 *
 * El CRM tiene una copia de estas funciones (`apps/admin`; no hay workspaces) y las dos ejecutan el
 * MISMO fixture (`__fixtures__/sucursales-casos.json`). Si cambia una, cambia la otra.
 *
 * Rebanada A: retiro y envío por zona. Rebanada B (lote 1): con `entrada.lineas` y una función de
 * stock, `asignarSucursal` también resuelve el ORIGEN de cada línea (respaldo por stock, líneas "a
 * traer", visibilidad por sucursal). Sin `lineas` el comportamiento es el de la A, idéntico.
 */
import { provinciaCanonica } from "./provincias";

/** Compara textos sin acentos, mayúsculas, espacios ni signos (misma normalización que `envio.ts`). */
function claveTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Clave de zona de una provincia tal como llega (perfil, formulario, cookie): la de su nombre
 * canónico (`provincias.ts` tolera acentos, "CABA", "Provincia de ..."). Un texto que no es una
 * jurisdicción da "" y cae en la sucursal predeterminada. Es la que se guarda en
 * `zonas.provincia_clave`.
 */
export function claveProvincia(provincia: string | null | undefined): string {
  const canonica = provinciaCanonica(provincia);
  return canonica ? claveTexto(canonica) : "";
}

/** Lo que estas funciones necesitan de una sucursal (subconjunto de `crmSucursales`). */
export interface SucursalDato {
  slug: string;
  aceptaRetiro: boolean;
  aceptaEnvio: boolean;
  /** Vacía = toda la zona; con ciudades = sólo esas. */
  envioCiudades: string[];
  orden: number;
  activa: boolean;
  predeterminada: boolean;
}

/** Lo que necesitan de una zona (subconjunto de `crmZonas`). */
export interface ZonaDato {
  id: string;
  provinciaClave: string;
  sucursal: string;
  facturaSucursal: string | null;
}

export type MotivoRegla = "zona" | "predeterminada" | "fallback_inactiva" | "retiro_local";

/**
 * La regla aplicada, tal como se congela en `orders.sucursal_regla`. `v` versiona la forma:
 * si cambia, un pedido viejo se sigue leyendo por su versión.
 */
export interface ReglaAplicada {
  v: 1;
  /** Identificador legible: `zona:misiones`, `zona:default`, `zona:fallback_inactiva`, `retiro:<slug>`. */
  regla: string;
  motivo: MotivoRegla;
  /** Clave de la provincia evaluada; null en el retiro (no depende de la zona). */
  provincia: string | null;
  zonaId: string | null;
  /** Sucursal que dicta la zona (en el retiro, la del local elegido). */
  sucursalZona: string;
  /** Cuenta que factura si la zona lo fuerza (`zonas.factura_sucursal`); null = la de despacho. */
  facturaSucursal: string | null;
  /** Ids de las líneas que se traen de otra sucursal (rebanada B); vacío en la A y sin respaldo. */
  lineasATraer: string[];
}

export interface ResolucionZona {
  sucursal: string;
  zonaId: string | null;
  motivo: Exclude<MotivoRegla, "retiro_local">;
  regla: string;
}

export type ErrorSucursal = "sin_sucursal_activa" | "sin_retiro" | "sin_envio";

const activas = (sucursales: SucursalDato[]) =>
  sucursales.filter((s) => s.activa).sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug));

/**
 * Sucursal de respaldo cuando la de la zona no sirve: la predeterminada activa; si tampoco, la
 * primera activa por `orden`; si no hay ninguna activa, null (el llamador falla explícito).
 */
function sucursalDeRespaldo(sucursales: SucursalDato[]): SucursalDato | null {
  const vivas = activas(sucursales);
  return vivas.find((s) => s.predeterminada) ?? vivas[0] ?? null;
}

/**
 * Sucursal que atiende una provincia. Sin zona para esa provincia = la predeterminada. Zona que
 * apunta a una sucursal inactiva = respaldo (`zona:fallback_inactiva`). Sin ninguna sucursal
 * activa NO asigna en silencio: devuelve `sin_sucursal_activa`.
 */
export function resolverZona(
  provincia: string | null | undefined,
  zonas: ZonaDato[],
  sucursales: SucursalDato[],
): ResolucionZona | { error: "sin_sucursal_activa" } {
  const clave = claveProvincia(provincia);
  const zona = clave ? zonas.find((z) => z.provinciaClave === clave) : undefined;

  if (zona) {
    const destino = sucursales.find((s) => s.slug === zona.sucursal);
    if (destino?.activa) {
      return { sucursal: destino.slug, zonaId: zona.id, motivo: "zona", regla: `zona:${clave}` };
    }
    const respaldo = sucursalDeRespaldo(sucursales);
    if (!respaldo) return { error: "sin_sucursal_activa" };
    return {
      sucursal: respaldo.slug,
      zonaId: zona.id,
      motivo: "fallback_inactiva",
      regla: "zona:fallback_inactiva",
    };
  }

  const predeterminada = sucursalDeRespaldo(sucursales);
  if (!predeterminada) return { error: "sin_sucursal_activa" };
  // Si la predeterminada no está activa y se cayó a otra, también es un respaldo por inactividad.
  const esLaPredeterminada = predeterminada.predeterminada;
  return {
    sucursal: predeterminada.slug,
    zonaId: null,
    motivo: esLaPredeterminada ? "predeterminada" : "fallback_inactiva",
    regla: esLaPredeterminada ? "zona:default" : "zona:fallback_inactiva",
  };
}

export interface EntradaAsignacion {
  entregaTipo: "retiro" | "envio";
  /** Provincia de entrega (envío). Se normaliza; el retiro la ignora. */
  provincia?: string | null;
  /** Ciudad de entrega (envío): se valida contra `envioCiudades` de la sucursal si tiene lista. */
  ciudad?: string | null;
  /** Slug del local elegido (retiro). */
  sucursalRetiro?: string | null;
  /**
   * Líneas del pedido (rebanada B). Con ellas, `asignarSucursal` necesita la función de stock y
   * resuelve el origen de cada una. Sin ellas se comporta como en la rebanada A.
   */
  lineas?: LineaEntrada[];
}

/** Una línea a asignar: `ocultoEn` = `catalog_overlay.oculto_en_sucursales` del producto. */
export interface LineaEntrada {
  id: string;
  qty: number;
  ocultoEn: string[];
}

/**
 * Disponible NETO de reserva de un producto en una sucursal. `null` = no inventariable (siempre
 * disponible); una sucursal sin fila de stock para un inventariable vale 0 (la resuelve quien
 * arma la función).
 */
export type StockFn = (sucursal: string, id: string) => number | null;

/** Reglas de venta que usa la asignación (subconjunto de `public.reglas_venta`). */
export interface ReglasVenta {
  /** Días de traslado entre sucursales; 0 = "a coordinar" (sin plazo numérico). */
  trasladoDias: number;
}

/** Cómo sale una línea del pedido (sólo con `entrada.lineas`). */
export interface LineaAsignada {
  id: string;
  /** Sucursal de la que sale la línea. */
  origen: string;
}

export interface Asignacion {
  sucursal: string;
  regla: ReglaAplicada;
  /** Origen por línea; sólo si la entrada trajo `lineas`. */
  lineas?: LineaAsignada[];
  /**
   * Demora por traslado cuando alguna línea es "a traer"; null si no hay ninguna. 0 = "a coordinar".
   * Sólo si la entrada trajo `lineas`.
   */
  demoraDias?: number | null;
}

/** Errores de la asignación por líneas (rebanada B); `ids` son las líneas afectadas. */
export interface ErrorLineas {
  error: "sin_stock" | "no_servible" | "sin_retiro";
  ids: string[];
}

/** Resultado de resolver el origen de UNA línea. */
export type OrigenLinea = { origen: string; aTraer: boolean } | { error: "sin_stock" | "no_servible" };

/**
 * Origen de una línea. `preferida` es la sucursal que debería despachar (la de la zona o el local de
 * retiro). Una sucursal en `linea.ocultoEn` NO es candidata (ni origen ni respaldo). Si la preferida
 * sirve la línea (stock suficiente o no inventariable), sale de ahí; si no, el respaldo es la
 * primera otra sucursal activa, por `orden`, que la cubra entera (una línea sale de UNA sola
 * sucursal). `aTraer` = el origen no es la preferida. Sin candidatas = `no_servible`; con
 * candidatas pero ninguna con stock = `sin_stock`.
 */
export function origenDeLinea(
  linea: LineaEntrada,
  preferida: string,
  sucursales: SucursalDato[],
  stock: StockFn,
): OrigenLinea {
  const candidatas = activas(sucursales).filter((s) => !linea.ocultoEn.includes(s.slug));
  if (candidatas.length === 0) return { error: "no_servible" };
  const cubre = (slug: string) => {
    const disponible = stock(slug, linea.id);
    return disponible === null || disponible >= linea.qty;
  };
  if (candidatas.some((s) => s.slug === preferida) && cubre(preferida)) {
    return { origen: preferida, aTraer: false };
  }
  const respaldo = candidatas.find((s) => s.slug !== preferida && cubre(s.slug));
  return respaldo ? { origen: respaldo.slug, aTraer: true } : { error: "sin_stock" };
}

/** Junta el origen de cada línea en una asignación, o el error de las que no se pueden servir. */
function resolverLineas(
  lineas: LineaEntrada[],
  preferida: string,
  sucursales: SucursalDato[],
  stock: StockFn,
  reglas: ReglasVenta | undefined,
): { lineas: LineaAsignada[]; aTraer: string[]; demoraDias: number | null } | ErrorLineas {
  const resueltas = lineas.map((l) => ({ l, r: origenDeLinea(l, preferida, sucursales, stock) }));
  const noServibles = resueltas.filter((x) => "error" in x.r && x.r.error === "no_servible").map((x) => x.l.id);
  if (noServibles.length > 0) return { error: "no_servible", ids: noServibles };
  const sinStock = resueltas.filter((x) => "error" in x.r).map((x) => x.l.id);
  if (sinStock.length > 0) return { error: "sin_stock", ids: sinStock };
  const ok = resueltas.map((x) => ({ id: x.l.id, ...(x.r as { origen: string; aTraer: boolean }) }));
  const aTraer = ok.filter((x) => x.aTraer).map((x) => x.id);
  return {
    lineas: ok.map(({ id, origen }) => ({ id, origen })),
    aTraer,
    demoraDias: aTraer.length > 0 ? (reglas?.trasladoDias ?? null) : null,
  };
}

/**
 * Asigna la sucursal del pedido.
 *
 * - Retiro: la del local elegido. Debe existir, estar activa y aceptar retiro; la zona NO cuenta.
 * - Envío: la de la zona de la provincia de entrega. Debe aceptar envío y, si tiene lista de
 *   ciudades, la ciudad de entrega tiene que estar en ella (sin ciudad, con lista: no hay envío).
 *
 * Con `entrada.lineas` (rebanada B) además resuelve el origen de cada línea: un solo pedido, sin
 * partirlo; las líneas que la preferida no cubre salen de otra sucursal ("a traer", con la demora
 * de `datos.reglas`). Retiro: una línea oculta en el local elegido no se retira ahí (`sin_retiro`
 * con los ids). Sin stock en ninguna: `sin_stock`; ninguna sucursal puede servirla por visibilidad:
 * `no_servible`. `regla.motivo` no cambia por el respaldo: lo dicen `regla.lineasATraer` y
 * `lineas`.
 */
export function asignarSucursal(
  entrada: EntradaAsignacion,
  datos: { sucursales: SucursalDato[]; zonas: ZonaDato[]; reglas?: ReglasVenta },
  stock?: StockFn,
): Asignacion | { error: ErrorSucursal } | ErrorLineas {
  const { sucursales, zonas } = datos;
  if (entrada.lineas && !stock) {
    throw new Error("asignarSucursal: con `lineas` hace falta la función de stock");
  }

  if (entrada.entregaTipo === "retiro") {
    const local = sucursales.find((s) => s.slug === entrada.sucursalRetiro);
    if (!local || !local.activa || !local.aceptaRetiro) return { error: "sin_retiro" };
    const ocultas = (entrada.lineas ?? []).filter((l) => l.ocultoEn.includes(local.slug)).map((l) => l.id);
    if (ocultas.length > 0) return { error: "sin_retiro", ids: ocultas };
    const porLineas =
      entrada.lineas && stock
        ? resolverLineas(entrada.lineas, local.slug, sucursales, stock, datos.reglas)
        : undefined;
    if (porLineas && "error" in porLineas) return porLineas;
    return {
      sucursal: local.slug,
      regla: {
        v: 1,
        regla: `retiro:${local.slug}`,
        motivo: "retiro_local",
        provincia: null,
        zonaId: null,
        sucursalZona: local.slug,
        facturaSucursal: null,
        lineasATraer: porLineas?.aTraer ?? [],
      },
      ...(porLineas ? { lineas: porLineas.lineas, demoraDias: porLineas.demoraDias } : {}),
    };
  }

  const zona = resolverZona(entrada.provincia, zonas, sucursales);
  if ("error" in zona) return zona;
  const destino = sucursales.find((s) => s.slug === zona.sucursal);
  if (!destino || !destino.aceptaEnvio) return { error: "sin_envio" };
  if (destino.envioCiudades.length > 0) {
    const ciudad = entrada.ciudad ? claveTexto(entrada.ciudad) : "";
    if (!ciudad || !destino.envioCiudades.some((c) => claveTexto(c) === ciudad)) {
      return { error: "sin_envio" };
    }
  }
  const porLineas =
    entrada.lineas && stock
      ? resolverLineas(entrada.lineas, destino.slug, sucursales, stock, datos.reglas)
      : undefined;
  if (porLineas && "error" in porLineas) return porLineas;
  const zonaFila = zona.zonaId ? zonas.find((z) => z.id === zona.zonaId) : undefined;
  return {
    sucursal: destino.slug,
    regla: {
      v: 1,
      regla: zona.regla,
      motivo: zona.motivo,
      provincia: claveProvincia(entrada.provincia) || null,
      zonaId: zona.zonaId,
      sucursalZona: destino.slug,
      facturaSucursal: zonaFila?.facturaSucursal ?? null,
      lineasATraer: porLineas?.aTraer ?? [],
    },
    ...(porLineas ? { lineas: porLineas.lineas, demoraDias: porLineas.demoraDias } : {}),
  };
}
