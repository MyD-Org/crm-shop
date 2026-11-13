/**
 * Plan del envío por zona de UNA cotización o pedido (change `envio-por-zona-con-tarifa`). SOLO servidor.
 *
 * Junta lo que `/api/carrito/cotizar` y `POST /api/pedidos` tienen que decidir igual para que "el total
 * que se ve sea el que se cobra":
 *  - el DESTINO: de dónde sale cada coordenada (nunca del body crudo: una dirección guardada del propio
 *    usuario o un `geoToken` firmado por el servidor cuya calle coincide con la enviada);
 *  - el ORIGEN (sucursal que despacha y si hay líneas a traer);
 *  - el costo (`costoEnvioPara`, un solo punto de entrada para `cotizar`) y si un cupón de envío gratis
 *    puede anular la tarifa (`envioGratisAplica`).
 *
 * Con el flag `envio-por-zona` apagado la config no trae `metodos`, así que ningún camino de acá cambia
 * nada: `costoEnvioPara` es undefined y `evaluar` es la regla de siempre.
 */
import { claveProvincia } from "./sucursales";
import { evaluarEnvio, type ConfigEnvio, type EnvioEvaluado, type EntregaTipo } from "./envio";
import type { DestinoEnvio } from "./envio-zona";
import { verificarGeo } from "./geo-token";
import type { ContextoDisponibilidad } from "./disponibilidad-contexto";
import type { DisponibilidadParaMostrar } from "./disponibilidad-vista";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GEOREF_ID = /^\d{1,12}$/;
const MAX_TOKEN = 1200;

/** Lo que el navegador manda para ubicar el destino. Las coordenadas crudas NO existen acá. */
export interface DestinoBody {
  direccionId?: string;
  geoToken?: string;
  calle?: string;
  localidad?: string;
  cp?: string;
  georefId?: string;
}

const texto = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
};

/** Sanea `body.destino`: strings acotadas; descarta cualquier otra clave (lat/lon crudos incluidos). */
export function leerDestinoBody(raw: unknown): DestinoBody {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const direccionId = texto(o.direccionId, 40);
  const geoToken = texto(o.geoToken, MAX_TOKEN + 1);
  const georefId = texto(o.georefId, 13);
  const calle = texto(o.calle, 200);
  const localidad = texto(o.localidad, 80);
  const cp = texto(o.cp, 12);
  return {
    ...(direccionId && UUID.test(direccionId) ? { direccionId } : {}),
    ...(geoToken && geoToken.length <= MAX_TOKEN ? { geoToken } : {}),
    ...(georefId && GEOREF_ID.test(georefId) ? { georefId } : {}),
    ...(calle ? { calle } : {}),
    ...(localidad ? { localidad } : {}),
    ...(cp ? { cp } : {}),
  };
}

/** Una dirección guardada del usuario (lat/lon los escribió el servidor a partir de un token firmado). */
export interface DireccionGuardada {
  calle: string;
  ciudad: string;
  provincia: string | null;
  cp: string | null;
  lat: number | null;
  lon: number | null;
}

/**
 * La dirección guardada no registra la precisión de su geocodificación: sin altura en la calle (ningún
 * número) se toma como "calle" (aproximada); con número, "altura".
 */
const precisionDeCalle = (calle: string): "altura" | "calle" => (/\d/.test(calle) ? "altura" : "calle");

/**
 * Arma el destino con coordenadas VERIFICADAS:
 *  (a) `direccionId` de una dirección guardada del propio usuario: lat/lon de la base, y la ciudad y el
 *      CP de esa dirección mandan sobre los del body;
 *  (b) `geoToken` válido cuya `calle` coincide con la calle enviada: coordenadas, ciudad y CP firmados;
 *  (c) si no, sin punto: sólo valen la localidad y el CP del body (reglas `georef` y `cp`).
 */
export async function resolverDestinoEnvio(a: {
  destino: DestinoBody;
  /** Provincia de entrega que el cliente indica (texto o clave). */
  provincia: string | null;
  clerkUserId: string | null;
  leerDireccion: (clerkUserId: string, id: string) => Promise<DireccionGuardada | null>;
  ahora?: number;
}): Promise<DestinoEnvio> {
  const { destino: b } = a;
  let provinciaTexto = a.provincia;
  let localidad = b.localidad ?? null;
  let cp = b.cp ?? null;
  let punto: DestinoEnvio["punto"] = null;

  if (b.direccionId && a.clerkUserId) {
    const dir = await a.leerDireccion(a.clerkUserId, b.direccionId);
    if (dir) {
      provinciaTexto = provinciaTexto ?? dir.provincia;
      localidad = dir.ciudad;
      cp = dir.cp ?? cp;
      if (dir.lat !== null && dir.lon !== null) {
        punto = { lat: dir.lat, lon: dir.lon, precision: precisionDeCalle(dir.calle) };
      }
    }
  } else if (b.geoToken && b.calle) {
    const g = verificarGeo(b.geoToken, { calle: b.calle }, a.ahora);
    if (g) {
      punto = { lat: g.lat, lon: g.lon, precision: g.precision };
      localidad = g.ciudad;
      cp = g.cp || cp;
    }
  }

  return {
    provinciaClave: claveProvincia(provinciaTexto) || null,
    localidad,
    georefId: b.georefId ?? null,
    cp,
    punto,
  };
}

/**
 * Origen del envío para condicionar el método: la sucursal de la zona (`disp.zona`) y si alguna línea se
 * trae de otra sucursal. null = no se conoce (flag `disponibilidad-sucursal` apagado): la condición de
 * origen del método se ignora al cotizar (la re-verifica `crearPedido` si hay asignación).
 */
export function origenDeEnvio(
  disp: ContextoDisponibilidad | undefined,
  disponibilidad: DisponibilidadParaMostrar | null,
): { sucursal: string | null; conTraslado: boolean } | null {
  if (!disp) return null;
  return { sucursal: disp.zona, conTraslado: (disponibilidad?.lineasATraer?.length ?? 0) > 0 };
}

export interface PlanEnvio {
  /** Costo del envío (con IVA) para `cotizar`; undefined = el envío no se cobra online (como siempre). */
  costoEnvioPara?: (subtotalSinIva: number) => number;
  /** ¿Un cupón de envío gratis puede anular la tarifa? true sin método por zona resuelto. */
  envioGratisAplica: boolean;
  /** Localidad atendida pero sin ubicación exacta (`direccion_sin_ubicar`). */
  sinUbicar: boolean;
  /** Evaluación completa del envío para la respuesta y el pedido. */
  evaluar: (subtotalSinIva: number, gratisCupon?: boolean) => EnvioEvaluado;
}

export function planEnvio(a: {
  config: ConfigEnvio;
  provincia: string | null | undefined;
  entregaTipo: EntregaTipo;
  destino: DestinoEnvio;
  origen: { sucursal: string | null; conTraslado: boolean } | null;
}): PlanEnvio {
  const evaluar = (subtotalSinIva: number, gratisCupon = false) =>
    evaluarEnvio(subtotalSinIva, a.provincia, a.config, { destino: a.destino, origen: a.origen, gratisCupon });
  const conMetodos = a.entregaTipo === "envio" && (a.config.metodos?.length ?? 0) > 0;
  if (!conMetodos) return { envioGratisAplica: true, sinUbicar: false, evaluar };
  const base = evaluar(0);
  const metodo = base.metodo ? a.config.metodos!.find((m) => m.id === base.metodo!.metodoId) : undefined;
  return {
    costoEnvioPara: (subtotalSinIva) => evaluar(subtotalSinIva).costo ?? 0,
    envioGratisAplica: metodo ? metodo.gratisAplica : true,
    sinUbicar: base.sinUbicar === true,
    evaluar,
  };
}
