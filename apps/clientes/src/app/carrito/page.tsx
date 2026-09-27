import { CarritoClient } from "@/components/CarritoClient";
import { getOfertaCuotasSinCache } from "@/lib/cuotas-datos";
import { identidadActual } from "@/lib/auth";
import { envioHabilitado } from "@/lib/envio-flag";

export default async function CarritoPage() {
  const [oferta, { clerkUserId, cliente }, envio] = await Promise.all([
    getOfertaCuotasSinCache(),
    identidadActual(),
    envioHabilitado(),
  ]);
  return <CarritoClient oferta={oferta} conSesion={!!(clerkUserId || cliente)} envio={envio} />;
}
