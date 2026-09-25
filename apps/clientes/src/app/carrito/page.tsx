import { CarritoClient } from "@/components/CarritoClient";
import { getOfertaCuotasSinCache } from "@/lib/cuotas-datos";
import { identidadActual } from "@/lib/auth";

export default async function CarritoPage() {
  const [oferta, { clerkUserId, cliente }] = await Promise.all([
    getOfertaCuotasSinCache(),
    identidadActual(),
  ]);
  return <CarritoClient oferta={oferta} conSesion={!!(clerkUserId || cliente)} />;
}
