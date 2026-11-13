/**
 * Flag `envio-por-zona` (change `envio-por-zona-con-tarifa`). Se lee sólo en el server, por request,
 * y NUNCA dentro de `use cache`: viaja como argumento a las lecturas cacheadas (`FlagsPublicos.envioZona`)
 * para que sea parte de la clave de la caché.
 *
 * Apagado (default): el Shop se comporta exactamente como antes. `leerConfigEnvio` devuelve
 * `metodos: []`, no se leen las tablas `metodos_envio*` del CRM, cotizar y crear el pedido no suman
 * costo de envío, no se exigen tokens de ubicación y el pedido no guarda snapshot.
 * Prendido: el método "Envío en el día" cotiza por zona y el costo entra al total.
 *
 * NO prender antes de que el CRM emita la línea "Envío" en la factura (rebanada D) en producción.
 *
 * Vive en Vercel Flags (key `envio-por-zona`, ver src/flags.ts): se cambia sin redeploy. Si no se
 * puede evaluar, se asume apagado.
 */
import { envioPorZonaFlag } from "@/flags";

export async function envioPorZonaHabilitado(): Promise<boolean> {
  try {
    return (await envioPorZonaFlag()) === true;
  } catch {
    return false;
  }
}
