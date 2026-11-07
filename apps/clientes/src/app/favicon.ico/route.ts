import { getMarca } from "@/lib/marca";
import { destinoFavicon } from "@/lib/metadata-marca";

/**
 * `/favicon.ico` según la marca. Los navegadores lo piden sin `<link>`, así que no puede ser un
 * archivo estático (lo heredaría cualquier marca): redirige al ícono propio, al de Central (sólo
 * la tienda de Central) o al neutro. Está fuera del gate del proxy (ver su matcher).
 */
export async function GET() {
  const destino = destinoFavicon(await getMarca());
  return new Response(null, {
    status: 308,
    headers: { Location: destino, "Cache-Control": "public, max-age=300" },
  });
}
