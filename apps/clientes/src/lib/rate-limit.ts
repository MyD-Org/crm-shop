/**
 * Rate limit por ventana fija, en la memoria del proceso. SOLO servidor.
 *
 * NO es distribuido: cada instancia lleva su propio conteo, así que con N
 * instancias vivas el límite efectivo es N veces el configurado. Es una
 * decisión, no un descuido: la alternativa es sumar Redis, y no vale la pena
 * por un endpoint de sugerencias de direcciones.
 *
 * Alcanza para lo que tiene que frenar —un script pegándole en loop a una ruta,
 * que aterriza en pocas instancias— y explícitamente NO alcanza para un ataque
 * distribuido. Si algún día hay que frenar eso, esto se reemplaza por un
 * contador en Redis manteniendo la misma firma.
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
