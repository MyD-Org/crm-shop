/**
 * Condiciones comerciales en pantalla (CON-1). Módulo PURO. Reglas portadas de
 * apps/admin/src/components/portal/CondicionesClient.tsx: lo que no está
 * cargado no se inventa.
 */
import type { CondicionesComerciales } from "./tipos";

export const SIN_DATOS = "Sin datos";

/**
 * Plazo en días como fila aparte: sólo si es > 0 y el nombre de la condición no
 * lo dice ya ("30 días"). `null` = no se muestra.
 */
export function plazoAparte(c: Pick<CondicionesComerciales, "condicionPago" | "plazoDias">): string | null {
  if (c.plazoDias == null || c.plazoDias <= 0) return null;
  if (c.condicionPago?.includes(String(c.plazoDias))) return null;
  return `${c.plazoDias} días`;
}

/** Límite de crédito del espejo para mostrar: sólo si está cargado y es > 0. */
export function limiteVisible(limite: number | null): number | null {
  return limite != null && limite > 0 ? limite : null;
}

/** "Ante cualquier duda, consulte con …" */
export function textoConsulta(tieneVendedor: boolean, tenant: string | null): string {
  if (tieneVendedor) return "Ante cualquier duda, consulte con su vendedor asignado.";
  return tenant ? `Ante cualquier duda, consulte con ${tenant}.` : "Ante cualquier duda, consulte con el local.";
}

/** `tel:` sólo con dígitos y `+`. */
export function hrefTelefono(telefono: string): string {
  return `tel:${telefono.replace(/[^+\d]/g, "")}`;
}
