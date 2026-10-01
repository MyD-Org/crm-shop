/**
 * Conteo para Entender (¿un filtro duro deja resultados?), con los mismos
 * filtros base que va a tener la página de destino. SOLO servidor.
 */
import { contarCatalogo } from "../catalog";
import type { ContextoDisponibilidad } from "../disponibilidad-contexto";
import type { Contar } from "./entender/combinar";

export function contador(base: {
  soloVisibles: boolean;
  soloStock: boolean;
  estructurados: boolean;
  disp?: ContextoDisponibilidad;
}): Contar {
  return ({ categorias, atributos, terminos }) =>
    contarCatalogo({
      soloVisibles: base.soloVisibles,
      disp: base.disp,
      filtros: {
        categorias,
        atributos,
        soloStock: base.soloStock,
        ...(base.estructurados ? { atributosEstructurados: true } : {}),
        // Los términos recuperan como en la página (comienzo de palabra, OR).
        ...(terminos?.length
          ? { planBusqueda: { consulta: terminos.join(" "), blandos: { categorias: [], atributos: [], terminos: terminos.map((texto) => ({ texto, peso: 1 })) } } }
          : {}),
      },
    });
}
