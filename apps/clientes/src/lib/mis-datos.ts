/**
 * Qué muestra "Mis datos" según la vinculación y el perfil de facturación.
 *
 * - `vinculado`: tiene cuenta de cliente; facturación en solo lectura y la
 *   card de la cuenta vinculada al final.
 * - `sugerir_vincular`: no vinculó, pero el documento que cargó ya es de un
 *   cliente (`coincideConAlegra`): `AvisoVincular` arriba de todo.
 * - `preguntar`: no vinculó y todavía no cargó datos de facturación. Antes del
 *   formulario se pregunta si ya es cliente: "Sí" lleva a vincular, "No"
 *   muestra el formulario.
 * - `formulario`: no vinculó y ya tiene perfil: el formulario de siempre y un
 *   enlace discreto para vincular al final.
 */
export type EstadoMisDatos = "vinculado" | "sugerir_vincular" | "preguntar" | "formulario";

export function estadoMisDatos({
  vinculado,
  tienePerfil,
  coincideConAlegra,
}: {
  vinculado: boolean;
  tienePerfil: boolean;
  coincideConAlegra: boolean;
}): EstadoMisDatos {
  if (vinculado) return "vinculado";
  if (coincideConAlegra) return "sugerir_vincular";
  return tienePerfil ? "formulario" : "preguntar";
}

/**
 * ¿Hay un perfil de facturación cargado? Una fila sin documento ni razón
 * social cuenta como vacía: no hay nada que mostrar en el formulario.
 */
export function tienePerfilFacturacion(
  perfil: { nroDoc?: string | null; razonSocial?: string | null } | null | undefined,
): boolean {
  return Boolean(perfil?.nroDoc?.trim() || perfil?.razonSocial?.trim());
}
