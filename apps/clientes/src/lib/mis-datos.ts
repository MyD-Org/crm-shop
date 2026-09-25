/**
 * ¿Hay un perfil de facturación cargado? Una fila sin documento ni razón
 * social cuenta como vacía: no hay nada que mostrar en el formulario.
 */
export function tienePerfilFacturacion(
  perfil: { nroDoc?: string | null; razonSocial?: string | null } | null | undefined,
): boolean {
  return Boolean(perfil?.nroDoc?.trim() || perfil?.razonSocial?.trim());
}
