/**
 * Armado de las consultas a Nominatim para el envío por zona (change `envio-por-zona-con-tarifa`).
 * Módulo PURO: lo usa `/api/geocode` cuando el flag `envio-por-zona` está prendido y el cliente indica la
 * localidad y la provincia ya elegidas.
 *
 * Con localidad la búsqueda se ACOTA a ella: consulta estructurada (`street`, `city`, `state`) y, si no
 * trae nada, UN reintento en texto libre ("calle, localidad, provincia"). Nunca cae a una búsqueda
 * nacional: una dirección de otra ciudad nunca sirve para calcular el envío de esta.
 */

export interface ConsultaGeocode {
  texto: string;
  ciudad: string;
  provincia: string;
  pais: string;
  idioma: string;
}

/**
 * Nominatim estructurado espera `street` como "<número> <calle>". Si el usuario escribió "Av. Colón 2500"
 * (el número al final) se pasa al frente; sin número queda como está.
 */
export function calleConAlturaAlFrente(texto: string): string {
  const t = texto.trim().replace(/\s+/g, " ");
  const m = /^(.*?[^\d\s,])[\s,]+(\d{1,6})$/.exec(t);
  return m ? `${m[2]} ${m[1]}` : t;
}

function base(c: ConsultaGeocode): URL {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("countrycodes", c.pais);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("accept-language", c.idioma);
  return url;
}

/** Consulta estructurada acotada a la localidad. Todo en minúsculas: la caché es por URL. */
export function urlEstructurada(c: ConsultaGeocode): URL {
  const url = base(c);
  url.searchParams.set("street", calleConAlturaAlFrente(c.texto).toLowerCase());
  url.searchParams.set("city", c.ciudad.toLowerCase());
  if (c.provincia) url.searchParams.set("state", c.provincia.toLowerCase());
  return url;
}

/** Reintento en texto libre: "<texto>, <localidad>, <provincia>". */
export function urlLibreAcotada(c: ConsultaGeocode): URL {
  const url = base(c);
  const q = [c.texto.trim(), c.ciudad, c.provincia].filter(Boolean).join(", ");
  url.searchParams.set("q", q.toLowerCase());
  return url;
}

/** Consulta de siempre (sin localidad). */
export function urlLibre(texto: string, pais: string, idioma: string): URL {
  const url = base({ texto, ciudad: "", provincia: "", pais, idioma });
  url.searchParams.set("q", texto.toLowerCase());
  return url;
}
