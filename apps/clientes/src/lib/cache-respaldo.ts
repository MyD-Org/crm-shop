/**
 * Respaldo de las lecturas `'use cache: remote'`. SOLO servidor.
 *
 * En prod la Runtime Cache tiró "Connection closed." al leer una entrada remota: el error sale del
 * `await` de la función cacheada (no de su cuerpo, así que su try/catch no lo ve) y tiraba la
 * página entera (checkout, Envíos y pagos, catálogo). Con esto, si la lectura cacheada falla, se
 * lee lo mismo sin caché y la página sigue.
 */
export async function conRespaldoSinCache<T>(
  nombre: string,
  cacheada: () => Promise<T>,
  directa: () => Promise<T>,
): Promise<T> {
  try {
    return await cacheada();
  } catch (err) {
    console.warn(
      `[cache] ${nombre}: falló la lectura cacheada, se lee sin caché:`,
      err instanceof Error ? err.message : err,
    );
    return directa();
  }
}
