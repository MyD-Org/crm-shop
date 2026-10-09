/**
 * Rate limit por ventana fija, en la memoria del proceso. SOLO servidor.
 * Mismo helper que usa el Shop (apps/clientes/src/lib/rate-limit.ts).
 *
 * NO es distribuido: cada instancia de Vercel lleva su propio conteo, así que con N
 * instancias vivas el límite efectivo es N veces el configurado, y se reinicia con cada
 * deploy. Alcanza para lo que tiene que frenar —un script pegándole en loop a una ruta,
 * que aterriza en pocas instancias— y explícitamente NO alcanza para un ataque
 * distribuido: eso se frena con las reglas de rate limit del Firewall de Vercel, en el
 * borde, antes de llegar a la función. Si algún día hace falta un contador compartido,
 * esto se reemplaza por Redis manteniendo la misma firma.
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
