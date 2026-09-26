import { notFound, redirect } from "next/navigation";
import { AvisoSeccionCaida } from "@/components/mi-cuenta/cuenta-corriente/AvisoSeccionCaida";
import { AvisosLista } from "@/components/mi-cuenta/cuenta-corriente/AvisosLista";
import { accesoFacturacion } from "@/lib/acceso-facturacion";
import { identidadActual } from "@/lib/auth";
import { listarAvisos } from "@/lib/cuenta-corriente/avisos";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA, seccionDesplegada } from "@/lib/mi-cuenta-nav";

/**
 * Avisos: los avisos de vencimiento que el CRM le envió al cliente (ex campana
 * del portal). Sólo la base: ninguna llamada a Alegra. Sólo cuenta corriente
 * (`accesoFacturacion`): sin vínculo o de contado ⇒ 404.
 */
export default async function AvisosPage() {
  if (!seccionDesplegada("avisos")) notFound();
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.avisos));
  if (!cliente || !(await accesoFacturacion())) notFound();

  let avisos: Awaited<ReturnType<typeof listarAvisos>>;
  try {
    avisos = await listarAvisos(cliente.codigocliente);
  } catch (err) {
    console.error(`mi-cuenta/avisos: lectura caída (${err instanceof Error ? err.name : "desconocido"})`);
    return <AvisoSeccionCaida que="sus avisos" />;
  }

  // Con acceso ya es cuenta corriente: "condiciones actualizadas" lleva a Condiciones.
  return <AvisosLista avisos={avisos} esCuentaCorriente />;
}
