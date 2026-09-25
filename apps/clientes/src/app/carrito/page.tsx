import { CarritoClient } from "@/components/CarritoClient";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { identidadActual } from "@/lib/auth";

// La oferta de cuotas se lee de la DB en cada request: no puede quedar
// congelada en el build.
export const dynamic = "force-dynamic";

export default async function CarritoPage() {
  const [oferta, { clerkUserId, cliente }] = await Promise.all([
    getOfertaCuotas(),
    identidadActual(),
  ]);
  return <CarritoClient oferta={oferta} conSesion={!!(clerkUserId || cliente)} />;
}
