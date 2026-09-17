import { CarritoClient } from "@/components/CarritoClient";
import { getOfertaCuotas } from "@/lib/cuotas-datos";

// La oferta de cuotas se lee de la DB en cada request: no puede quedar
// congelada en el build.
export const dynamic = "force-dynamic";

export default async function CarritoPage() {
  const oferta = await getOfertaCuotas();
  return <CarritoClient oferta={oferta} />;
}
