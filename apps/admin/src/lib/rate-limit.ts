import { createClient } from "redis"

/**
 * Rate limit por ventana fija. SOLO servidor.
 * Mismo helper que usa el Shop (apps/clientes/src/lib/rate-limit.ts).
 *
 * Dos contadores con la misma semántica:
 *
 * - `permitirAsync` cuenta en Redis (Upstash, por TCP con node-redis) cuando hay URL, así que el
 *   límite es UNO para todas las instancias de Vercel y sobrevive a los deploys. Ante cualquier
 *   problema con Redis (sin URL, timeout, error de conexión, respuesta rara) cae al contador en
 *   memoria: el límite nunca bloquea a nadie porque Redis esté caído, sólo vuelve a ser por
 *   instancia.
 * - `permitir` cuenta en la memoria del proceso. NO es distribuido: cada instancia lleva su propio
 *   conteo, así que con N instancias vivas el límite efectivo es N veces el configurado, y se
 *   reinicia con cada deploy. Queda como respaldo y para lo que no pueda esperar una promesa.
 *
 * URL (la inyecta la integración de Upstash desde Vercel Storage, como `rediss://...`): `REDIS_URL`
 * en el CRM y `UPSTASH_REDIS_REST_REDIS_URL` en el Shop (el nombre feo, con "REST" aunque es TCP,
 * lo arma la integración con su prefijo). Se aceptan las dos en las dos apps.
 */

interface Ventana {
  /** Epoch ms en el que la ventana deja de valer. */
  hasta: number
  usos: number
}

const ventanas = new Map<string, Ventana>()

/** Techo de claves vivas: sin esto el Map crece sin límite (fuga de memoria con forma de defensa). */
const MAX_CLAVES = 10_000

/** Saca las ventanas ya vencidas. O(n), pero corre sólo al llegar al techo. */
function podar(ahora: number) {
  for (const [clave, v] of ventanas) {
    if (v.hasta <= ahora) ventanas.delete(clave)
  }
  // Si después de podar sigue lleno, hay más tráfico legítimo del previsto: se vacía entero.
  // Perder el conteo es preferible a quedarse sin memoria.
  if (ventanas.size >= MAX_CLAVES) ventanas.clear()
}

/**
 * ¿Este pedido entra dentro del límite? Consume un uso cuando devuelve `true`.
 * Contador en memoria del proceso (ver arriba). Preferir `permitirAsync`.
 *
 * @param clave      Quién pide, ya namespaceado por endpoint (`verify-code:t1:ip:1.2.3.4`).
 * @param maxUsos    Usos permitidos dentro de la ventana.
 * @param ventanaMs  Largo de la ventana.
 */
export function permitir(clave: string, maxUsos: number, ventanaMs: number): boolean {
  if (maxUsos <= 0) return false

  const ahora = Date.now()
  const actual = ventanas.get(clave)

  if (!actual || actual.hasta <= ahora) {
    if (ventanas.size >= MAX_CLAVES) podar(ahora)
    ventanas.set(clave, { hasta: ahora + ventanaMs, usos: 1 })
    return true
  }

  if (actual.usos >= maxUsos) return false

  actual.usos++
  return true
}

// ---------------------------------------------------------------------------
// Contador compartido en Redis
// ---------------------------------------------------------------------------

/**
 * Lo que puede esperar un request por Redis (conectar y contar). Si tarda más, el request sigue
 * con el contador local: un rate limit no puede ser lo que hace lenta la ruta.
 */
export const REDIS_TIMEOUT_MS = 300

/**
 * Después de un fallo no se vuelve a intentar con Redis durante este tiempo: si está caído,
 * pagar el timeout en CADA request sería peor que contar en memoria un rato.
 */
export const REDIS_PAUSA_TRAS_FALLO_MS = 30_000

type ClienteRedis = ReturnType<typeof crearCliente>

interface EstadoRedis {
  url: string
  cliente: ClienteRedis
  /** La conexión inicial, para que los primeros requests la esperen en vez de fallar. */
  conexion: Promise<unknown>
  /** Epoch ms hasta el que no se vuelve a intentar, tras un fallo. */
  pausadoHasta: number
}

// Singleton lazy en globalThis (mismo patrón que getDb): en dev Next recarga módulos y, en
// serverless, el cliente sobrevive entre invocaciones de la misma instancia.
const globalForRedis = globalThis as unknown as { crmRateLimitRedis?: EstadoRedis }

/** Se lee en cada llamada, sin cachear: los tests y un cambio de entorno no dependen del orden de carga. */
function urlRedis(): string | null {
  return process.env.REDIS_URL?.trim() || process.env.UPSTASH_REDIS_REST_REDIS_URL?.trim() || null
}

function crearCliente(url: string) {
  return createClient({
    url,
    // Sin cola: si no hay conexión el comando falla ya mismo y se cae a memoria, en vez de
    // quedar esperando a que Redis vuelva.
    disableOfflineQueue: true,
    socket: {
      connectTimeout: REDIS_TIMEOUT_MS,
      // Tres reintentos cortos y se rinde (false): nada de reconectar para siempre.
      reconnectStrategy: (reintentos: number) => (reintentos >= 3 ? false : 100),
    },
  })
}

/** Para no inundar los logs: se avisa una vez por proceso que Redis falló. */
let avisadoFallo = false

function avisarFallo(motivo: string) {
  if (avisadoFallo) return
  avisadoFallo = true
  console.warn(`[rate-limit] Redis no disponible (${motivo}); se cuenta en memoria por instancia`)
}

function estadoRedis(url: string): EstadoRedis {
  const cache = globalForRedis.crmRateLimitRedis
  // `isOpen` se apaga cuando la reconexión se rinde (ver `reconnectStrategy`): ahí se descarta el
  // cliente y el siguiente intento, pasada la pausa, arranca con uno nuevo.
  if (cache?.cliente && cache.url === url && cache.cliente.isOpen) return cache
  if (cache?.cliente) cache.cliente.destroy()

  const cliente = crearCliente(url)
  // Obligatorio: sin listener, un error de socket es un `error` sin manejar y tira el proceso.
  cliente.on("error", (err: unknown) => avisarFallo(err instanceof Error ? err.message : "error de socket"))

  const estado: EstadoRedis = {
    url,
    cliente,
    conexion: cliente.connect().catch((err: unknown) => {
      avisarFallo(err instanceof Error ? err.message : "no se pudo conectar")
      throw err
    }),
    pausadoHasta: 0,
  }
  globalForRedis.crmRateLimitRedis = estado
  return estado
}

/** Espera `promesa` como mucho `REDIS_TIMEOUT_MS`; si no llegó, rechaza. */
function conTimeout<T>(promesa: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const vence = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), REDIS_TIMEOUT_MS)
  })
  return Promise.race([promesa, vence]).finally(() => clearTimeout(timer))
}

/**
 * Cuenta el uso en Redis. Devuelve `null` cuando no se pudo contar ahí (y el llamador decide qué
 * hacer), nunca lanza.
 *
 * Ventana fija: la clave lleva el número de ventana (`floor(ahora / ventana)`), así que al cambiar
 * de ventana el contador arranca de cero solo, sin coordinar nada. El PEXPIRE es limpieza: la
 * clave vieja muere sola. INCR + PEXPIRE van en un MULTI (un viaje de red).
 */
async function contarEnRedis(url: string, clave: string, ventanaMs: number): Promise<number | null> {
  const ahora = Date.now()
  if ((globalForRedis.crmRateLimitRedis?.pausadoHasta ?? 0) > ahora) return null

  const claveRedis = `rl:${clave}:${Math.floor(ahora / ventanaMs)}`
  let estado: EstadoRedis | undefined
  try {
    estado = estadoRedis(url)
    await conTimeout(estado.conexion)
    const respuestas = await conTimeout(estado.cliente.multi().incr(claveRedis).pExpire(claveRedis, ventanaMs).exec())
    const usos = Array.isArray(respuestas) ? respuestas[0] : undefined
    if (typeof usos !== "number") {
      avisarFallo("respuesta inesperada")
      estado.pausadoHasta = Date.now() + REDIS_PAUSA_TRAS_FALLO_MS
      return null
    }
    return usos
  } catch (err) {
    avisarFallo(err instanceof Error ? err.message : "error desconocido")
    const e = estado ?? globalForRedis.crmRateLimitRedis
    if (e) e.pausadoHasta = Date.now() + REDIS_PAUSA_TRAS_FALLO_MS
    return null
  }
}

/**
 * ¿Este pedido entra dentro del límite? Misma semántica que `permitir`, pero contando en Redis
 * cuando hay URL (ver arriba). Ante cualquier problema con Redis cae a `permitir`.
 *
 * Diferencia menor con la versión en memoria: los pedidos rechazados también suman en Redis. No
 * cambia nada visible porque la ventana es fija (no se corre con cada intento), y evita un
 * segundo viaje de red para leer antes de escribir.
 */
export async function permitirAsync(clave: string, maxUsos: number, ventanaMs: number): Promise<boolean> {
  if (maxUsos <= 0) return false

  const url = urlRedis()
  if (!url) return permitir(clave, maxUsos, ventanaMs)

  const usos = await contarEnRedis(url, clave, ventanaMs)
  if (usos === null) return permitir(clave, maxUsos, ventanaMs)

  return usos <= maxUsos
}

/**
 * IP del cliente para las claves de rate limit. En Vercel `x-forwarded-for` lo arma la
 * plataforma (el navegador no puede falsearlo); fuera de Vercel cae a `x-real-ip` o a una
 * clave compartida, que limita a todos juntos antes que a nadie.
 */
export function ipDe(request: Request): string {
  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return xff || request.headers.get("x-real-ip")?.trim() || "desconocida"
}

/** Respuesta 429 uniforme, en usted. */
export function respuestaLimite(mensaje = "Demasiados intentos. Espere unos minutos e inténtelo de nuevo."): Response {
  return Response.json({ error: mensaje }, { status: 429, headers: { "Cache-Control": "private, no-store" } })
}
