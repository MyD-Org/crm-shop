import { HomeClient } from "@/components/HomeClient";
import { getOfertaCuotas } from "@/lib/cuotas-datos";

// La oferta de cuotas se lee de la DB en cada request (config del CRM y
// refresh lazy): no puede quedar congelada en el build.
export const dynamic = "force-dynamic";

export default async function Home() {
  const oferta = await getOfertaCuotas();
  return <HomeClient oferta={oferta} />;
}
