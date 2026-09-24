import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { AvisoSeccionCaida } from "@/components/mi-cuenta/cuenta-corriente/AvisoSeccionCaida";
import { ComprobantesPagos } from "@/components/mi-cuenta/cuenta-corriente/ComprobantesPagos";
import { PagosSeccion } from "@/components/mi-cuenta/cuenta-corriente/PagosSeccion";
import { identidadActual } from "@/lib/auth";
import { listarDelCliente } from "@/lib/comprobantes/repo";
import { contactoPorId } from "@/lib/contactos-espejo";
import { getPagosPage } from "@/lib/cuenta-corriente/erp-cc";
import { motivoAlegra } from "@/lib/cuenta-corriente/mensajes";
import { datosTenant } from "@/lib/cuenta-corriente/tenant-cc";
import { contactoWhatsApp } from "@/lib/cuenta-corriente/whatsapp";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA, rutaVincular, seccionDesplegada } from "@/lib/mi-cuenta-nav";
import { comprobantesR2Config } from "@/lib/r2";
import { shopTenantId } from "@/lib/tenant";

// Datos de UN cliente, leídos en vivo de Alegra: nunca prerenderizar ni cachear.
export const dynamic = "force-dynamic";

/**
 * Pagos: los recibos de pago del cliente vinculado (de a 10, con "Cargar más"),
 * el detalle con las facturas imputadas y el PDF en un visor dentro de la
 * página, más "Informar pago" y "Mis comprobantes" cuando el almacenamiento de
 * comprobantes está configurado (CMP-5). Todo vinculado la ve, contado incluido.
 */
export default async function PagosPage() {
  if (!seccionDesplegada("pagos")) notFound();
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.pagos));

  // Sin vínculo no se llama a Alegra ni se lee `public`: se ofrece vincular.
  if (!cliente) {
    return (
      <EmptyState
        title="Vincule su cuenta de cliente para ver su cuenta corriente."
        action={<BotonEnlace href={rutaVincular(RUTAS_MI_CUENTA.pagos)}>Vincular mi cuenta</BotonEnlace>}
      />
    );
  }

  const codigo = cliente.codigocliente;
  const comprobantes = comprobantesR2Config() !== null;
  const [paginaR, tenantR, contactoR, comprobantesR] = await Promise.allSettled([
    getPagosPage(codigo),
    datosTenant(),
    contactoPorId(codigo),
    comprobantes ? listarDelCliente(shopTenantId(), codigo, 0) : Promise.resolve(null),
  ]);
  for (const [bloque, r] of [
    ["pagos", paginaR],
    ["tenant", tenantR],
    ["contacto", contactoR],
    ["comprobantes", comprobantesR],
  ] as const) {
    // Sólo el motivo técnico: nunca el cuerpo de Alegra ni datos del contacto.
    if (r.status === "rejected") console.error(`mi-cuenta/pagos: ${bloque} caído (${motivoAlegra(r.reason)})`);
  }

  // Informar pago no depende de Alegra: se ofrece aunque los pagos no carguen.
  const bloqueComprobantes = comprobantes && (
    <ComprobantesPagos primeraPagina={comprobantesR.status === "fulfilled" ? comprobantesR.value : null} />
  );
  if (paginaR.status === "rejected") {
    return (
      <div className="flex flex-col gap-8">
        {bloqueComprobantes}
        <AvisoSeccionCaida que="sus pagos" />
      </div>
    );
  }

  // Razón social y CUIT del espejo si se pudo leer; si no, los de la identidad.
  const contacto = contactoR.status === "fulfilled" ? contactoR.value : null;
  const whatsapp = contactoWhatsApp(tenantR.status === "fulfilled" ? tenantR.value : null, {
    razonsocial: contacto?.nombre ?? cliente.razonsocial,
    cuit: contacto?.identificacion ?? cliente.cuit,
  });

  return (
    <div className="flex flex-col gap-8">
      {bloqueComprobantes}
      <PagosSeccion primeraPagina={paginaR.value} whatsapp={whatsapp} />
    </div>
  );
}
