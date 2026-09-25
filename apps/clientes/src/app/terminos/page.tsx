import type { Metadata } from "next";
import { PaginaLegal } from "@/components/legales/PaginaLegal";
import { esAdmin } from "@/lib/auth";
import { cuotasHabilitadas } from "@/lib/cuotas-flag";
import { getDatosLegales } from "@/lib/home-datos";
import { bloquesTerminos } from "@/lib/legales/terminos";

export const metadata: Metadata = { title: "Términos y condiciones" };

export default async function TerminosPage() {
  const [datos, cuotas, puedeEditar] = await Promise.all([getDatosLegales(), cuotasHabilitadas(), esAdmin()]);
  return (
    <PaginaLegal
      titulo="Términos y condiciones"
      bloques={bloquesTerminos(datos, { cuotas })}
      datos={datos}
      puedeEditar={puedeEditar}
    />
  );
}
