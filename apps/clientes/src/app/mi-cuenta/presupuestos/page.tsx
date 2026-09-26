import { notFound, redirect } from "next/navigation";
import { AvisoSeccionCaida } from "@/components/mi-cuenta/cuenta-corriente/AvisoSeccionCaida";
import { PresupuestosSeccion } from "@/components/mi-cuenta/cuenta-corriente/PresupuestosSeccion";
import { accesoFacturacion } from "@/lib/acceso-facturacion";
import { identidadActual } from "@/lib/auth";
import { contactoPorId } from "@/lib/contactos-espejo";
import { getPresupuestosPage } from "@/lib/cuenta-corriente/erp-cc";
import { motivoAlegra } from "@/lib/cuenta-corriente/mensajes";
import { datosTenant } from "@/lib/cuenta-corriente/tenant-cc";
import { contactoWhatsApp } from "@/lib/cuenta-corriente/whatsapp";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA, seccionDesplegada } from "@/lib/mi-cuenta-nav";

/**
 * Presupuestos: la lista del cliente vinculado (de a 30, con "Cargar más"),
 * filtros Todos / Aceptados / Sin aceptar y fecha de emisión resueltos en
 * Alegra, WhatsApp para avanzar o consultar y el PDF en un visor dentro de la
 * página. Sólo cuenta corriente
 * (`accesoFacturacion`): sin vínculo o de contado ⇒ 404.
 */
export default async function PresupuestosPage() {
  if (!seccionDesplegada("presupuestos")) notFound();
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.presupuestos));

  // Sin acceso (sin vínculo o de contado) la sección no existe: ni Alegra ni `public`.
  if (!cliente || !(await accesoFacturacion())) notFound();

  const codigo = cliente.codigocliente;
  const [paginaR, tenantR, contactoR] = await Promise.allSettled([
    getPresupuestosPage(codigo),
    datosTenant(),
    contactoPorId(codigo),
  ]);
  for (const [bloque, r] of [
    ["presupuestos", paginaR],
    ["tenant", tenantR],
    ["contacto", contactoR],
  ] as const) {
    // Sólo el motivo técnico: nunca el cuerpo de Alegra ni datos del contacto.
    if (r.status === "rejected") console.error(`mi-cuenta/presupuestos: ${bloque} caído (${motivoAlegra(r.reason)})`);
  }
  if (paginaR.status === "rejected") return <AvisoSeccionCaida que="sus presupuestos" />;

  // Razón social y CUIT del espejo si se pudo leer; si no, los de la identidad.
  const contacto = contactoR.status === "fulfilled" ? contactoR.value : null;
  const whatsapp = contactoWhatsApp(tenantR.status === "fulfilled" ? tenantR.value : null, {
    razonsocial: contacto?.nombre ?? cliente.razonsocial,
    cuit: contacto?.identificacion ?? cliente.cuit,
  });

  return <PresupuestosSeccion primeraPagina={paginaR.value} whatsapp={whatsapp} />;
}
