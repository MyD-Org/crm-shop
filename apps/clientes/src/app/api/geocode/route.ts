import { getMarca } from "@/lib/marca";
import { idTecnico } from "@/lib/marca-base";
import { NextResponse } from "next/server";
import { claveSolicitante } from "@/lib/auth";
import { codigoPaisGeocode, idiomaGeocode } from "@/lib/geocode-pais";
import { permitirAsync } from "@/lib/rate-limit";
import { envioPorZonaHabilitado } from "@/lib/envio-zona-flag";
import { urlEstructurada, urlLibre, urlLibreAcotada } from "@/lib/geocode-envio";
import { firmarGeo, geoFirmaConfigurada } from "@/lib/geo-token";
import { compraInvitadoHabilitada } from "@/lib/compra-invitado-flag";
import { ipDelRequest } from "@/lib/ip-cliente";

/**
 * Autocompletado de direcciones contra Nominatim (OpenStreetMap), acotado al
 * país que eligió el cliente (`?pais=AR|BR|PY`; sin país, Argentina).
 *
 * Por qué Nominatim y no otro: se compararon los tres gratuitos contra
 * direcciones reales de Puerto Iguazú y Eldorado. Nominatim fue el único que
 * devolvió **altura y código postal** ("Avenida Victoria Aguirre 500", CP 3370).
 * Photon devuelve la calle sin altura ni CP, y Georef (del gobierno argentino)
 * no tiene datos de calles en Misiones: devuelve 0 resultados.
 *
 * El riesgo de Nominatim es su política de uso: pide como máximo 1 request por
 * segundo y desaconseja el autocompletado. El bloqueo sería por IP del
 * servidor, o sea que dejaría sin sugerencias a TODOS los clientes a la vez.
 *
 * El volumen se controla en dos capas, y la distinción importa:
 *
 * En el SERVIDOR, que es lo único que de verdad frena a alguien:
 *   1. Sesión, o compra como invitado (flag `compra-invitado`). Sin cuenta la
 *      ruta sería un proxy abierto: al invitado se le exige un request del mismo
 *      sitio, un techo por IP más bajo que el de las cuentas y un techo global
 *      para todos los invitados juntos, que es lo que protege la IP del servidor.
 *   2. Rate limit por usuario (o por IP para el invitado).
 *   3. La cache de acá, que absorbe las búsquedas repetidas.
 *
 * En el CLIENTE, que solo mejora el caso honesto y no defiende de nada:
 *   4. Debounce de 500 ms y mínimo de 4 caracteres (DireccionAutocomplete).
 *
 * Y un `User-Agent` identificable, que su política exige.
 *
 * Si algún día el volumen se va de escala, LocationIQ es Nominatim como
 * servicio: misma forma de respuesta, se cambia la URL base y se agrega la key.
 */

interface NominatimResult {
  display_name: string;
  lat?: string;
  lon?: string;
  address: {
    suburb?: string;
    neighbourhood?: string;
    road?: string;
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    postcode?: string;
    state?: string;
  };
}

/**
 * Una semana. Las calles no se mudan, y en Iguazú y Eldorado la cantidad de
 * direcciones distintas es finita y chica: las mismas búsquedas se repiten
 * muchísimo entre clientes, así que la mayoría no llega a salir a Nominatim.
 */
const CACHE_SEGUNDOS = 60 * 60 * 24 * 7;

const MIN_CARACTERES = 4;

/**
 * Techo por usuario. Con debounce de 500 ms, escribir una dirección entera
 * genera del orden de 10 llamadas: 40 por minuto deja lugar para corregir y
 * reintentar varias veces sin que nadie honesto lo note, y corta en seco a un
 * script en loop.
 */
const MAX_POR_MINUTO = 40;

/** Invitado, por IP: una dirección cómoda por minuto y un tope diario que corta a un script. */
const INVITADO_POR_MINUTO = 20;
const INVITADO_POR_DIA = 300;
/** Todos los invitados juntos: con la cache, mantiene el volumen hacia Nominatim lejos de su límite. */
const INVITADOS_POR_MINUTO_GLOBAL = 120;

/** Sólo un fetch del propio sitio (los navegadores mandan `Sec-Fetch-Site`; un script suelto, no). */
function mismoSitio(req: Request): boolean {
  return req.headers.get("sec-fetch-site") === "same-origin";
}

/**
 * Saca los prefijos administrativos de OSM: devuelve "Municipio de Puerto
 * Iguazú" y "Provincia de Misiones", que en una factura quedan mal. También
 * normaliza el caso especial de CABA, que OSM llama "Ciudad Autónoma de Buenos
 * Aires" y en un domicilio fiscal se escribe así, pero como ciudad es "CABA".
 */
function limpiarNombre(v: string | undefined): string {
  if (!v) return "";
  return v
    .replace(/^(Municipio|Partido|Departamento|Provincia|Comuna|Estado)\s+(de|do|da)\s+/i, "")
    .replace(/^Municipio\s+/i, "")
    .trim();
}

export async function GET(req: Request) {
  // El autocompletado se usa en checkout y datos de facturación: con cuenta, o sin cuenta cuando la
  // compra como invitado está habilitada (con límites más estrictos, ver arriba).
  const demasiadas = () =>
    NextResponse.json({ error: "Demasiadas búsquedas. Espere un momento." }, { status: 429 });
  const clave = await claveSolicitante();
  if (clave) {
    if (!await permitirAsync(`geocode:${clave}`, MAX_POR_MINUTO, 60_000)) return demasiadas();
  } else {
    const ip = ipDelRequest(req);
    if (!ip || !mismoSitio(req) || !(await compraInvitadoHabilitada())) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (
      !(await permitirAsync(`geocode:inv:ip:${ip}`, INVITADO_POR_MINUTO, 60_000)) ||
      !(await permitirAsync(`geocode:inv:dia:${ip}`, INVITADO_POR_DIA, 86_400_000)) ||
      !(await permitirAsync("geocode:inv:global", INVITADOS_POR_MINUTO_GLOBAL, 60_000))
    ) {
      return demasiadas();
    }
  }

  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text")?.trim();

  if (!text || text.length < MIN_CARACTERES) return NextResponse.json([]);

  const pais = searchParams.get("pais");
  const codigoPais = codigoPaisGeocode(pais);
  const idioma = idiomaGeocode(pais);
  // Envío por zona: con localidad y provincia elegidas la búsqueda se acota a ellas y cada sugerencia
  // trae coordenadas y un token firmado. Con el flag apagado nada de esto existe: la respuesta es la de siempre.
  const porZona = await envioPorZonaHabilitado();
  const ciudadElegida = porZona ? (searchParams.get("ciudad")?.trim().slice(0, 80) ?? "") : "";
  const provinciaElegida = porZona ? (searchParams.get("provincia")?.trim().slice(0, 80) ?? "") : "";
  const acotada = ciudadElegida !== "";

  const userAgent = `${idTecnico(await getMarca())}-Shop/1.0 (${process.env.GEOCODE_CONTACT_EMAIL ?? "contacto@cliente.example"})`;
  // Devuelve null si no hubo respuesta usable (timeout, sin red).
  const consultar = async (url: URL): Promise<Response | null> => {
    try {
      return await fetch(url.toString(), {
        // La política de Nominatim exige identificarse con un contacto real: va en
        // GEOCODE_CONTACT_EMAIL. El respaldo es una dirección de ejemplo, solo para desarrollo.
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(5000),
        next: { revalidate: CACHE_SEGUNDOS },
      });
    } catch {
      // Timeout o sin red: lista vacía. El cliente puede escribir a mano — que el
      // autocompletado falle no puede impedir cargar una dirección.
      return null;
    }
  };

  let res: Response | null;
  let data: NominatimResult[];
  if (acotada) {
    const consulta = { texto: text, ciudad: ciudadElegida, provincia: provinciaElegida, pais: codigoPais, idioma };
    res = await consultar(urlEstructurada(consulta));
    if (!res) return NextResponse.json([]);
    if (!res.ok) return NextResponse.json([], { status: res.status });
    data = (await res.json()) as NominatimResult[];
    if (data.length === 0) {
      // UN reintento en texto libre acotado; sigue vacío ⇒ [] (nunca una búsqueda nacional).
      res = await consultar(urlLibreAcotada(consulta));
      if (!res) return NextResponse.json([]);
      if (!res.ok) return NextResponse.json([], { status: res.status });
      data = (await res.json()) as NominatimResult[];
    }
  } else {
    // Normalizado a minúsculas: la cache es por URL, así "San Martin" y
    // "san martin" comparten entrada en vez de ocupar dos.
    res = await consultar(urlLibre(text, codigoPais, idioma));
    if (!res) return NextResponse.json([]);
    if (!res.ok) return NextResponse.json([], { status: res.status });
    data = (await res.json()) as NominatimResult[];
  }
  const conToken = porZona && geoFirmaConfigurada();

  const suggestions = data.map((r) => {
    const addr = r.address;
    const calle = [addr.road, addr.house_number].filter(Boolean).join(" ");
    const ciudad = limpiarNombre(addr.city ?? addr.town ?? addr.village);
    const provincia = limpiarNombre(addr.state);
    const cp = addr.postcode ?? "";
    const label = [calle, ciudad, provincia].filter(Boolean).join(", ");
    const base = { label, calle, ciudad, provincia, cp };
    if (!porZona) return base;
    const lat = Number.parseFloat(r.lat ?? "");
    const lon = Number.parseFloat(r.lon ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return base;
    // `house_number` ⇒ la coordenada es de la altura; si no, es el centro de la calle (aproximada).
    const precision = addr.house_number ? ("altura" as const) : ("calle" as const);
    const barrio = addr.suburb ?? addr.neighbourhood ?? "";
    let geoToken: string | undefined;
    if (conToken && calle) {
      try {
        geoToken = firmarGeo({ lat, lon, calle, ciudad, provincia, cp, precision });
      } catch {
        geoToken = undefined;
      }
    }
    return { ...base, lat, lon, precision, ...(barrio ? { barrio } : {}), ...(geoToken ? { geoToken } : {}) };
  });

  return NextResponse.json(suggestions);
}
