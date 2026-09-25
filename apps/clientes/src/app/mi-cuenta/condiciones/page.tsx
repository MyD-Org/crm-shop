import { notFound, redirect } from "next/navigation";
import { AvisoSeccionCaida } from "@/components/mi-cuenta/cuenta-corriente/AvisoSeccionCaida";
import { Condiciones } from "@/components/mi-cuenta/cuenta-corriente/Condiciones";
import { identidadActual } from "@/lib/auth";
import { contactoPorId } from "@/lib/contactos-espejo";
import { getCondiciones } from "@/lib/cuenta-corriente/erp-cc";
import { motivoAlegra } from "@/lib/cuenta-corriente/mensajes";
import { datosTenant } from "@/lib/cuenta-corriente/tenant-cc";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA, seccionDesplegada } from "@/lib/mi-cuenta-nav";

/**
 * Condiciones comerciales: SÓLO cuenta corriente (según el espejo del CRM, como
 * el portal). Contado o sin vínculo ⇒ 404: la sección no existe para ellos y el
 * menú tampoco la ofrece. Sin llamadas a Alegra para listar documentos: espejo
 * de contactos + condiciones cargadas en el CRM (el contacto que falta en el
 * espejo se busca UNA vez en vivo, como en el resto de la cuenta corriente).
 */
export default async function CondicionesPage() {
  if (!seccionDesplegada("condiciones")) notFound();
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.condiciones));
  if (!cliente) notFound();

  const codigo = cliente.codigocliente;
  let contacto: Awaited<ReturnType<typeof contactoPorId>>;
  try {
    contacto = await contactoPorId(codigo);
  } catch (err) {
    console.error(`mi-cuenta/condiciones: espejo caído (${motivoAlegra(err)})`);
    return <AvisoSeccionCaida que="sus condiciones comerciales" />;
  }
  // Sin contacto no se sabe si es cuenta corriente: aviso de caída, no un 404 engañoso.
  if (!contacto) return <AvisoSeccionCaida que="sus condiciones comerciales" />;
  if (contacto.tipoCuenta !== "corriente") notFound();

  const [condicionesR, tenantR] = await Promise.allSettled([getCondiciones(codigo, contacto), datosTenant()]);
  if (condicionesR.status === "rejected") {
    console.error(`mi-cuenta/condiciones: condiciones caídas (${motivoAlegra(condicionesR.reason)})`);
    return <AvisoSeccionCaida que="sus condiciones comerciales" />;
  }

  return (
    <Condiciones
      condiciones={condicionesR.value}
      razonsocial={contacto.nombre}
      cuit={contacto.identificacion}
      limiteCredito={contacto.limiteCredito}
      tenant={tenantR.status === "fulfilled" ? (tenantR.value?.nombre ?? null) : null}
    />
  );
}
