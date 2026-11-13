/**
 * Lógica pura del checkout para el envío por zona (change `envio-por-zona-con-tarifa`, flag
 * `envio-por-zona`). Decide qué ubicación viaja al servidor y arma los campos extra de
 * `POST /api/pedidos`. Sin React ni fetch, para poder probarla.
 *
 * Lo que el navegador manda NUNCA son coordenadas: una dirección guardada (`direccionId`) o el
 * `geoToken` firmado de la sugerencia elegida (con la calle firmada). El servidor las verifica.
 */
import type { DestinoCotizacion } from "@/hooks/useCotizacion";
import type { EleccionInicialCheckout } from "./checkout-ubicacion";

/** Sugerencia del autocompletado que trajo un token (sólo con el flag prendido y el secreto configurado). */
export interface UbicacionElegida {
  geoToken: string;
  /** La calle FIRMADA: la dirección del formulario tiene que seguir siendo esta. */
  calle: string;
  cp: string;
  precision?: "altura" | "calle";
}

export interface EntradaDestino {
  /** Dirección guardada elegida (su ubicación la lee el servidor). */
  guardadaId: string | null;
  /** Sugerencia elegida en "otra dirección". */
  ubicacion: UbicacionElegida | null;
  /** Texto de la calle que hoy está en el formulario. */
  calleActual: string;
  /** Localidad de entrega. */
  ciudad: string;
}

/**
 * La ubicación elegida vale mientras el texto de la calle siga siendo el de la sugerencia: si el comprador
 * lo edita, la ubicación firmada ya no corresponde a lo que escribió.
 */
export function ubicacionVigente(ubicacion: UbicacionElegida | null, calleActual: string): UbicacionElegida | null {
  return ubicacion && ubicacion.calle.trim() === calleActual.trim() ? ubicacion : null;
}

/** Destino para `/api/carrito/cotizar`. Vacío (`{}`) = nada que mandar. */
export function destinoParaCotizar(e: EntradaDestino): DestinoCotizacion {
  const ciudad = e.ciudad.trim();
  if (e.guardadaId) return { direccionId: e.guardadaId };
  const u = ubicacionVigente(e.ubicacion, e.calleActual);
  return {
    ...(u ? { geoToken: u.geoToken, calle: u.calle } : {}),
    ...(ciudad ? { localidad: ciudad } : {}),
    ...(u?.cp ? { cp: u.cp } : {}),
  };
}

/** Campos extra de `POST /api/pedidos` para el envío por zona. */
export function camposPedidoEnvioZona(a: {
  entrada: EntradaDestino;
  /** El comprador eligió «Continuar con envío a coordinar». */
  envioACoordinar: boolean;
  /** Costo de envío de la cotización que vio (para distinguir `envio_cambio`). */
  costoEnvioVisto: number | undefined;
}): Record<string, unknown> {
  const d = destinoParaCotizar(a.entrada);
  const resto = d.localidad || d.cp ? { destino: { ...(d.localidad ? { localidad: d.localidad } : {}), ...(d.cp ? { cp: d.cp } : {}) } } : {};
  return {
    ...(d.direccionId ? { direccionId: d.direccionId } : {}),
    ...(d.geoToken ? { entregaGeoToken: d.geoToken } : {}),
    ...resto,
    ...(a.envioACoordinar ? { envioACoordinar: true } : {}),
    ...(a.costoEnvioVisto !== undefined ? { costoEnvioVisto: a.costoEnvioVisto } : {}),
  };
}

/**
 * Dirección con la que arranca el formulario de «otra dirección» cuando el visitante usó «Usar mi ubicación»
 * (calle exacta, localidad, CP y su `geoToken`). Sólo si hay envío por zona, la entrega es a domicilio y el
 * comprador no tiene direcciones guardadas: con una guardada no se pisa nada. Si edita la calle, el token deja
 * de valer (`ubicacionVigente`), igual que con una sugerencia del autocompletado.
 */
export function precargaDeUbicacion(a: {
  eleccion: EleccionInicialCheckout | null | undefined;
  envioPorZona: boolean;
  direccionesGuardadas: number;
}): { direccion: string; ciudad: string; ubicacion: UbicacionElegida } | null {
  const x = a.eleccion?.tipo === "envio" ? a.eleccion.exacta : undefined;
  if (!a.envioPorZona || a.direccionesGuardadas > 0 || !x || a.eleccion?.direccionId) return null;
  return {
    direccion: x.calle,
    ciudad: x.localidad,
    ubicacion: { geoToken: x.geoToken, calle: x.calle, cp: x.cp ?? "", precision: x.precision },
  };
}
