import type { Metadata } from "next";
import { PaginaLegal } from "@/components/legales/PaginaLegal";
import { cuotasHabilitadas } from "@/lib/cuotas-flag";
import { getDatosLegales } from "@/lib/home-datos";
import { bloquesTerminos } from "@/lib/legales/terminos";

export const metadata: Metadata = { title: "Términos y condiciones" };

export default async function TerminosPage() {
  const [datos, cuotas] = await Promise.all([getDatosLegales(), cuotasHabilitadas()]);
  return (
    <PaginaLegal
      titulo="Términos y condiciones"
      bloques={bloquesTerminos(datos, { cuotas })}
      datos={datos}
    />
  );
}
