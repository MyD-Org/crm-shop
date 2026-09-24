import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { AvisoSeccionCaida } from "@/components/mi-cuenta/cuenta-corriente/AvisoSeccionCaida";
import { AvisosLista } from "@/components/mi-cuenta/cuenta-corriente/AvisosLista";
import { identidadActual } from "@/lib/auth";
import { tipoCuentaEspejo } from "@/lib/contactos-espejo";
import { listarAvisos } from "@/lib/cuenta-corriente/avisos";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA, rutaVincular, seccionDesplegada } from "@/lib/mi-cuenta-nav";

// Avisos de UN cliente, con su estado de lectura: nunca prerenderizar ni cachear.
export const dynamic = "force-dynamic";

/**
 * Avisos: los avisos de vencimiento que el CRM le envió al cliente (ex campana
 * del portal). Sólo la base: ninguna llamada a Alegra. Todo vinculado la ve,
 * contado incluido.
 */
export default async function AvisosPage() {
  if (!seccionDesplegada("avisos")) notFound();
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.avisos));

  if (!cliente) {
    return (
      <EmptyState
        title="Vincule su cuenta de cliente para recibir avisos de sus facturas."
        action={<BotonEnlace href={rutaVincular(RUTAS_MI_CUENTA.avisos)}>Vincular mi cuenta</BotonEnlace>}
      />
    );
  }

  const codigo = cliente.codigocliente;
  const [avisosR, tipoR] = await Promise.allSettled([listarAvisos(codigo), tipoCuentaEspejo(codigo)]);
  if (avisosR.status === "rejected") {
    console.error(`mi-cuenta/avisos: lectura caída (${avisosR.reason instanceof Error ? avisosR.reason.name : "desconocido"})`);
    return <AvisoSeccionCaida que="sus avisos" />;
  }
  // Sin espejo, "condiciones actualizadas" lleva a Facturas y saldo (siempre visible).
  const esCuentaCorriente = tipoR.status === "fulfilled" && tipoR.value === "corriente";

  return <AvisosLista avisos={avisosR.value} esCuentaCorriente={esCuentaCorriente} />;
}
