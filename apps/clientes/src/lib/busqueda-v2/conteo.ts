/**
 * Conteo para Entender (¿un filtro duro deja resultados?), con los mismos
 * filtros base que va a tener la página de destino. SOLO servidor.
 */
import { contarCatalogo } from "../catalog";
import type { ClaveEstructurada } from "../catalogo-caracteristicas";
import type { ContextoDisponibilidad } from "../disponibilidad-contexto";
import type { Contar } from "./entender/combinar";

/**
 * Un `Contar` que además acepta `conClaves` (sólo productos con dato de esas claves: cobertura de
 * una clave en el universo). Asignable a `Contar`: quien ya lo usa no cambia.
 */
export type ContarConClaves = (filtros: Parameters<Contar>[0] & { conClaves?: ClaveEstructurada[] }) => Promise<number>;

export function contador(base: {
  soloVisibles: boolean;
  soloStock: boolean;
  estructurados: boolean;
  disp?: ContextoDisponibilidad;
  /**
   * Las medidas (ids dinámicos de atributo) cuentan en modo positivo: sólo lo que cumple, no lo que
   * "no contradice". Para saber si hay al menos un producto que SÍ cumple.
   */
  positivos?: boolean;
}): ContarConClaves {
  return ({ categorias, atributos, terminos, nombreConTodos, conClaves }) =>
    contarCatalogo({
      soloVisibles: base.soloVisibles,
      disp: base.disp,
      filtros: {
        categorias,
        atributos,
        soloStock: base.soloStock,
        ...(base.estructurados ? { atributosEstructurados: true } : {}),
        ...(base.positivos ? { medidasPositivas: true } : {}),
        ...(conClaves?.length ? { conClaves } : {}),
        ...(nombreConTodos?.length ? { nombreConTodos } : {}),
        // Los términos recuperan como en la página (comienzo de palabra, OR).
        ...(terminos?.length
          ? { planBusqueda: { consulta: terminos.join(" "), blandos: { categorias: [], atributos: [], terminos: terminos.map((texto) => ({ texto, peso: 1 })) } } }
          : {}),
      },
    });
}
