/**
 * Rate limit por ventana fija. SOLO servidor.
 *
 * Dos contadores con la misma semántica:
 *
 * - `permitirAsync` cuenta en Upstash Redis (REST) cuando hay credenciales, así
 *   que el límite es UNO para todas las instancias de Vercel y sobrevive a los
 *   deploys. Ante cualquier problema con Redis (sin credenciales, timeout,
 *   error de red o respuesta rara) cae al contador en memoria: el límite nunca
 *   bloquea a nadie porque Redis esté caído, sólo vuelve a ser por instancia.
 * - `permitir` cuenta en la memoria del proceso. NO es distribuido: cada
 *   instancia lleva su propio conteo, así que con N instancias vivas el límite
 *   efectivo es N veces el configurado, y se reinicia con cada deploy. Queda
 *   como respaldo y para los pocos lugares que no pueden esperar una promesa.
 *
 * Credenciales (las inyecta la integración de Upstash desde Vercel Storage):
 * `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, o como alternativa
 * `KV_REST_API_URL` + `KV_REST_API_TOKEN`. Se leen en cada llamada, sin
 * cachear, para que los tests y un cambio de entorno no dependan del orden de
 * carga del módulo.
 */

interface Ventana {
  /** Epoch ms en el que la ventana deja de valer. */
  hasta: number;
  usos: number;
}

const ventanas = new Map<string, Ventana>();

/**
 * Techo de claves vivas. Sin esto el Map crece sin límite y se convierte en una
 * fuga de memoria con forma de defensa.
 */
const MAX_CLAVES = 10_000;

/** Saca las ventanas ya vencidas. O(n), pero corre solo al llegar al techo. */
function podar(ahora: number) {
  for (const [clave, v] of ventanas) {
    if (v.hasta <= ahora) ventanas.delete(clave);
  }
  // Si después de podar sigue lleno, hay más tráfico legítimo concurrente del
  // previsto: se vacía entero. Perder el conteo es preferible a quedarse sin
  // memoria, y el peor caso es que unos pocos requests pasen de más.
  if (ventanas.size >= MAX_CLAVES) ventanas.clear();
}

/**
 * ¿Este pedido entra dentro del límite? Consume un uso cuando devuelve `true`.
 * Contador en memoria del proceso (ver arriba). Preferir `permitirAsync`.
 *
 * @param clave      Quién pide, ya namespaceado por endpoint (`geocode:clerk:x`).
 * @param maxUsos    Usos permitidos dentro de la ventana.
 * @param ventanaMs  Largo de la ventana.
 */
export function permitir(
  clave: string,
  maxUsos: number,
  ventanaMs: number,
): boolean {
  // Antes que nada: con un máximo de 0 (o negativo) no pasa nadie. Sin esto, la
  // rama de "ventana nueva" de abajo devuelve `true` sin haber mirado el
  // máximo, y un límite de 0 dejaría pasar el primero.
  if (maxUsos <= 0) return false;

  const ahora = Date.now();
  const actual = ventanas.get(clave);

  if (!actual || actual.hasta <= ahora) {
    if (ventanas.size >= MAX_CLAVES) podar(ahora);
    ventanas.set(clave, { hasta: ahora + ventanaMs, usos: 1 });
    return true;
  }

  if (actual.usos >= maxUsos) return false;

  actual.usos++;
  return true;
}

// ---------------------------------------------------------------------------
// Contador compartido en Upstash Redis
// ---------------------------------------------------------------------------

/**
 * Lo que puede esperar un request por Redis. Si tarda más, el request sigue
 * con el contador local: un rate limit no puede ser lo que hace lenta la ruta.
 */
export const REDIS_TIMEOUT_MS = 300;

interface CredencialesRedis {
  url: string;
  token: string;
}

/**
 * URL y token se toman SIEMPRE del mismo par: mezclar la URL de una variable
 * con el token de la otra apuntaría a una base con la llave de otra.
 */
function credencialesRedis(): CredencialesRedis | null {
  const env = process.env;
  const pares: Array<[string | undefined, string | undefined]> = [
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
  ];
  for (const [url, token] of pares) {
    const u = url?.trim();
    const t = token?.trim();
    if (u && t) return { url: u.replace(/\/+$/, ""), token: t };
  }
  return null;
}

/** Para no inundar los logs: se avisa una vez por proceso que Redis falló. */
let avisadoFallo = false;

function avisarFallo(motivo: string) {
  if (avisadoFallo) return;
  avisadoFallo = true;
  console.warn(`[rate-limit] Redis no disponible (${motivo}); se cuenta en memoria por instancia`);
}

/**
 * Cuenta el uso en Redis. Devuelve `null` cuando no se pudo contar ahí (y el
 * llamador decide qué hacer), nunca lanza.
 *
 * Ventana fija: la clave lleva el número de ventana (`floor(ahora / ventana)`),
 * así que al cambiar de ventana el contador arranca de cero solo, sin
 * coordinar nada. El PEXPIRE es limpieza: la clave vieja muere sola.
 * INCR + PEXPIRE van en un solo pipeline (un viaje de red).
 */
async function contarEnRedis(
  cred: CredencialesRedis,
  clave: string,
  ventanaMs: number,
): Promise<number | null> {
  const ventana = Math.floor(Date.now() / ventanaMs);
  const claveRedis = `rl:${clave}:${ventana}`;
  try {
    const res = await fetch(`${cred.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cred.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", claveRedis],
        ["PEXPIRE", claveRedis, String(ventanaMs)],
      ]),
      signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      avisarFallo(`HTTP ${res.status}`);
      return null;
    }
    const datos: unknown = await res.json();
    const primero = Array.isArray(datos) ? (datos[0] as { result?: unknown; error?: unknown } | undefined) : undefined;
    if (!primero || typeof primero.result !== "number") {
      avisarFallo(typeof primero?.error === "string" ? primero.error : "respuesta inesperada");
      return null;
    }
    return primero.result;
  } catch (err) {
    avisarFallo(err instanceof Error ? err.name : "error desconocido");
    return null;
  }
}

/**
 * ¿Este pedido entra dentro del límite? Misma semántica que `permitir`, pero
 * contando en Redis cuando hay credenciales (ver arriba). Ante cualquier
 * problema con Redis cae a `permitir` en memoria.
 *
 * Diferencia menor con la versión en memoria: los pedidos rechazados también
 * suman en Redis. No cambia nada visible porque la ventana es fija (no se
 * corre con cada intento), y evita un segundo viaje de red para leer antes de
 * escribir.
 */
export async function permitirAsync(
  clave: string,
  maxUsos: number,
  ventanaMs: number,
): Promise<boolean> {
  if (maxUsos <= 0) return false;

  const cred = credencialesRedis();
  if (!cred) return permitir(clave, maxUsos, ventanaMs);

  const usos = await contarEnRedis(cred, clave, ventanaMs);
  if (usos === null) return permitir(clave, maxUsos, ventanaMs);

  return usos <= maxUsos;
}
