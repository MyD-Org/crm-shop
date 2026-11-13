/**
 * Punto exacto de «Usar mi ubicación» con el envío por zona (flag `envio-por-zona`). SOLO servidor.
 *
 * La cookie `shop_ubicacion` guarda la calle mostrable, el CP, el nombre de la zona y un `geoToken` firmado;
 * las coordenadas viajan sólo dentro del token. Acá se verifica ese token (firma, vencimiento y que la calle
 * de la cookie sea la firmada) y se arma el destino para resolver la zona. Sin secreto, token vencido o calle
 * distinta = null: queda la localidad de siempre.
 */
import { verificarGeo } from "./geo-token";
import type { DestinoEnvio } from "./envio-zona";
import type { EleccionUbicacion } from "./ubicacion";

export interface UbicacionExactaVerificada {
  calle: string;
  zona?: string;
  geoToken: string;
  cp?: string;
  localidad: string;
  precision: "altura" | "calle";
  /** Destino con las coordenadas verificadas, para `cotizarMetodo`. */
  destino: DestinoEnvio;
}

export function ubicacionExactaVerificada(
  eleccion: EleccionUbicacion,
  provinciaClave: string | null,
  ahora?: number,
): UbicacionExactaVerificada | null {
  if (eleccion.tipo !== "envio" || !eleccion.exacta || eleccion.direccion) return null;
  const { calle, zona, geoToken } = eleccion.exacta;
  const g = verificarGeo(geoToken, { calle }, ahora);
  if (!g) return null;
  const cp = g.cp || eleccion.cp || undefined;
  return {
    calle,
    ...(zona ? { zona } : {}),
    geoToken,
    ...(cp ? { cp } : {}),
    localidad: g.ciudad,
    precision: g.precision,
    destino: {
      provinciaClave,
      localidad: g.ciudad,
      cp: cp ?? null,
      punto: { lat: g.lat, lon: g.lon, precision: g.precision },
    },
  };
}
