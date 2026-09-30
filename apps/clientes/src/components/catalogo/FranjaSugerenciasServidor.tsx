import type { EstadoCatalogo } from "@/lib/catalogo-url";
import { interpretar } from "@/lib/busqueda-inteligente/servidor";
import { hayQueAplicar } from "@/lib/busqueda-inteligente/tipos";
import { chipsSugeridos, hrefInterpretada } from "@/lib/busqueda-inteligente/url";
import { FranjaSugerencias } from "./FranjaBusqueda";

/**
 * Hueco por streaming de la franja cuando la búsqueda SÍ trajo resultados
 * (server, dentro de un `<Suspense fallback={null}>` de la page): la grilla
 * sale al instante y esto llega cuando la interpretación termina (caché,
 * determinista o Jev, ~0,5 s). Si no hay nada que proponer, no dibuja nada.
 */
export async function FranjaSugerenciasServidor({ estado, consulta }: { estado: EstadoCatalogo; consulta: string }) {
  // Sólo la página 1 cuenta como búsqueda (las siguientes son la misma búsqueda paginada).
  const interpretacion = await interpretar(consulta, { sumarUso: estado.pagina === 1 });
  if (!interpretacion) return null;
  const chips = chipsSugeridos(estado, [interpretacion.aplicar, interpretacion.sugerir]);
  if (chips.length === 0) return null;
  const aplicables = interpretacion.aplicar.categorias.length + interpretacion.aplicar.atributos.length;
  return (
    <FranjaSugerencias
      consulta={consulta}
      chips={chips}
      aplicarTodoHref={hayQueAplicar(interpretacion) && aplicables > 1 ? hrefInterpretada(estado, interpretacion) : undefined}
    />
  );
}
