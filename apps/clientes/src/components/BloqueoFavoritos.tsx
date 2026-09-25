import { identidadActual } from "@/lib/auth";
import { BloquearFavoritos } from "@/context/FavoritosContext";

/**
 * Hueco del layout (server, dentro de `<Suspense fallback={null}>`): quien
 * entra sólo con la cookie del CRM no tiene usuario de Clerk donde guardar
 * favoritos y no ve el corazón. `identidadActual` está en `cache()`: el header
 * la resuelve en el mismo request.
 */
export async function BloqueoFavoritos() {
  const identidad = await identidadActual();
  return !identidad.clerkUserId && identidad.cliente ? <BloquearFavoritos /> : null;
}
