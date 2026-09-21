import { NextResponse } from "next/server";
import { claveSolicitante } from "@/lib/auth";
import { permitir } from "@/lib/rate-limit";

/**
 * Autocompletado de direcciones argentinas contra Nominatim (OpenStreetMap).
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
 *   1. Sesión obligatoria. Sin esto la ruta es un proxy abierto y cualquiera
 *      con un `for` deja el autocompletado caído para todos los clientes.
 *   2. Rate limit por usuario.
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
  address: {
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

/**
 * Saca los prefijos administrativos de OSM: devuelve "Municipio de Puerto
 * Iguazú" y "Provincia de Misiones", que en una factura quedan mal. También
 * normaliza el caso especial de CABA, que OSM llama "Ciudad Autónoma de Buenos
 * Aires" y en un domicilio fiscal se escribe así, pero como ciudad es "CABA".
 */
function limpiarNombre(v: string | undefined): string {
  if (!v) return "";
  return v
    .replace(/^(Municipio|Partido|Departamento|Provincia|Comuna)\s+de\s+/i, "")
    .replace(/^Municipio\s+/i, "")
    .trim();
}

export async function GET(req: Request) {
  // El autocompletado solo se usa en checkout y datos de facturación, las dos
  // detrás de sesión: exigirla acá no le saca nada a nadie.
  const clave = await claveSolicitante();
  if (!clave) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!permitir(`geocode:${clave}`, MAX_POR_MINUTO, 60_000)) {
    return NextResponse.json(
      { error: "Demasiadas búsquedas. Esperá un momento." },
      { status: 429 },
    );
  }

  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text")?.trim();

  if (!text || text.length < MIN_CARACTERES) return NextResponse.json([]);

  const url = new URL("https://nominatim.openstreetmap.org/search");
  // Normalizado a minúsculas: la cache es por URL, así "San Martin" y
  // "san martin" comparten entrada en vez de ocupar dos.
  url.searchParams.set("q", text.toLowerCase());
  url.searchParams.set("countrycodes", "ar");
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("accept-language", "es");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      // La política de Nominatim exige identificarse con un contacto real.
      headers: { "User-Agent": "CentralLed-Shop/1.0 (contacto@cliente.example)" },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: CACHE_SEGUNDOS },
    });
  } catch {
    // Timeout o sin red: lista vacía. El cliente puede escribir a mano — que el
    // autocompletado falle no puede impedir cargar una dirección.
    return NextResponse.json([]);
  }

  if (!res.ok) return NextResponse.json([], { status: res.status });

  const data = (await res.json()) as NominatimResult[];

  const suggestions = data.map((r) => {
    const addr = r.address;
    const calle = [addr.road, addr.house_number].filter(Boolean).join(" ");
    const ciudad = limpiarNombre(addr.city ?? addr.town ?? addr.village);
    const provincia = limpiarNombre(addr.state);
    const cp = addr.postcode ?? "";
    const label = [calle, ciudad, provincia].filter(Boolean).join(", ");
    return { label, calle, ciudad, provincia, cp };
  });

  return NextResponse.json(suggestions);
}
