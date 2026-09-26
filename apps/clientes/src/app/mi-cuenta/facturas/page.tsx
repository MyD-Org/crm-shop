import { notFound, redirect } from "next/navigation";
import { FacturasYSaldo } from "@/components/mi-cuenta/cuenta-corriente/FacturasYSaldo";
import { accesoFacturacion } from "@/lib/acceso-facturacion";
import { identidadActual } from "@/lib/auth";
import { resolverDeepLink } from "@/lib/cuenta-corriente/deep-link";
import { getCuenta, getFacturasPage, muestraLimite } from "@/lib/cuenta-corriente/erp-cc";
import { motivoAlegra } from "@/lib/cuenta-corriente/mensajes";
import { datosTenant } from "@/lib/cuenta-corriente/tenant-cc";
import { contactoWhatsApp } from "@/lib/cuenta-corriente/whatsapp";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA, seccionDesplegada } from "@/lib/mi-cuenta-nav";

/**
 * "Facturas y saldo": el saldo (deuda, vencido, a vencer) y la lista de
 * facturas del cliente vinculado, con el PDF en un visor dentro de la página.
 * La primera página viene del servidor; "Cargar más" y los filtros van a
 * `/api/mi-cuenta/facturas`. Sólo cuenta corriente según el espejo
 * (`accesoFacturacion`): sin vínculo o de contado ⇒ 404. El límite de crédito,
 * sólo con límite cargado.
 */
export default async function FacturasPage({
  searchParams,
}: {
  searchParams: Promise<{ factura?: string | string[]; alegra?: string | string[] }>;
}) {
  if (!seccionDesplegada("facturas")) notFound();
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.facturas));

  // Sin acceso (sin vínculo o de contado) la sección no existe: ni Alegra ni `public`.
  if (!cliente || !(await accesoFacturacion())) notFound();

  const codigo = cliente.codigocliente;
  const [cuentaR, paginaR, tenantR] = await Promise.allSettled([
    getCuenta(codigo),
    getFacturasPage(codigo),
    datosTenant(),
  ]);
  for (const [bloque, r] of [
    ["saldo", cuentaR],
    ["facturas", paginaR],
    ["tenant", tenantR],
  ] as const) {
    // Sólo el motivo técnico: nunca el cuerpo de Alegra ni datos del contacto.
    if (r.status === "rejected") console.error(`mi-cuenta/facturas: ${bloque} caído (${motivoAlegra(r.reason)})`);
  }
  const cuenta = cuentaR.status === "fulfilled" ? cuentaR.value : null;
  const pagina = paginaR.status === "fulfilled" ? paginaR.value : null;
  const tenant = tenantR.status === "fulfilled" ? tenantR.value : null;

  const deepLink = await resolverDeepLink(codigo, await searchParams, [
    ...(pagina?.facturas ?? []),
    ...(cuenta?.abiertas ?? []),
  ]);

  // El mensaje de WhatsApp identifica al cliente por razón social y CUIT: del
  // espejo si se pudo leer, si no de la identidad. Sin número de la empresa no hay botones.
  const whatsapp = contactoWhatsApp(tenant, {
    razonsocial: cuenta?.cliente.razonsocial ?? cliente.razonsocial,
    cuit: cuenta?.cliente.cuit ?? cliente.cuit,
  });

  // Defensivo: si Alegra lo diera de contado (el espejo dijo corriente), el
  // bloque Saldo sólo aparece si debe algo. Sin saldo, el tipo de la identidad.
  const mostrarSaldo = cuenta
    ? cuenta.cliente.tipoCuenta === "corriente" || cuenta.cliente.deudatotal > 0 || cuenta.abiertas.length > 0
    : cliente.tipoCuenta === "corriente";

  return (
    <FacturasYSaldo
      cuenta={cuenta}
      mostrarSaldo={mostrarSaldo}
      mostrarLimite={cuenta ? muestraLimite(cuenta.cliente) : false}
      primeraPagina={pagina}
      whatsapp={whatsapp}
      deepLink={deepLink}
    />
  );
}
