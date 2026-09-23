/**
 * Compartir un enlace desde la ficha. En el celular abre la hoja nativa
 * (WhatsApp, mail…); donde no existe `navigator.share` (la mayoría de los
 * escritorios) copia el enlace al portapapeles.
 */
export type ResultadoCompartir = "compartido" | "copiado" | "cancelado" | "error";

type Nav = Partial<Pick<Navigator, "share" | "clipboard">>;

export async function compartirEnlace(
  datos: { url: string; titulo: string },
  nav: Nav | undefined = globalThis.navigator,
): Promise<ResultadoCompartir> {
  if (nav?.share) {
    try {
      await nav.share({ title: datos.titulo, url: datos.url });
      return "compartido";
    } catch (err) {
      // Cerrar la hoja sin elegir nada no es un error: no se avisa nada.
      if ((err as { name?: string })?.name === "AbortError") return "cancelado";
      // Cualquier otro rechazo (permiso, contexto no seguro): se cae a copiar.
    }
  }
  try {
    if (!nav?.clipboard) return "error";
    await nav.clipboard.writeText(datos.url);
    return "copiado";
  } catch {
    return "error";
  }
}
