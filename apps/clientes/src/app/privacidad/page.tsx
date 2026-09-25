import type { Metadata } from "next";
import { PaginaLegal } from "@/components/legales/PaginaLegal";
import { esAdmin } from "@/lib/auth";
import { getDatosLegales } from "@/lib/home-datos";
import { bloquesPrivacidad } from "@/lib/legales/privacidad";

export const metadata: Metadata = { title: "Política de privacidad" };

export default async function PrivacidadPage() {
  const [datos, puedeEditar] = await Promise.all([getDatosLegales(), esAdmin()]);
  return (
    <PaginaLegal
      titulo="Política de privacidad"
      bloques={bloquesPrivacidad(datos)}
      datos={datos}
      puedeEditar={puedeEditar}
    />
  );
}
