import { CarritoClient } from "@/components/CarritoClient";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { identidadActual } from "@/lib/auth";

export default async function CarritoPage() {
  const [oferta, { clerkUserId, cliente }] = await Promise.all([
    getOfertaCuotas(),
    identidadActual(),
  ]);
  return <CarritoClient oferta={oferta} conSesion={!!(clerkUserId || cliente)} />;
}
