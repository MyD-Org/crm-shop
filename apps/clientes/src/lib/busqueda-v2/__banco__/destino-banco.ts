/**
 * Lo que decide `/buscar` para el banco, con la función REAL (`destinoDeBusqueda`): ¿la búsqueda
 * clásica o `ia=1` con los duros del plan en la URL? Después se lee esa URL como la lee la página
 * del catálogo. Lo comparten la tubería `motor` y el oráculo `legado`, así los dos parten del mismo
 * estado. SOLO scripts.
 */
import { contarCatalogo } from "@/lib/catalog";
import { filtrosDeEstado, leerEstado, type EstadoCatalogo } from "@/lib/catalogo-url";
import { destinoDeBusqueda } from "../buscar";
import type { PlanBusqueda } from "../plan";
import type { VistaBanco } from "./vista";

/** Estado de catálogo al que `/buscar` redirige para la consulta `q` bajo la vista. */
export async function estadoDeBusqueda(
  q: string,
  vista: VistaBanco,
  plan: PlanBusqueda | null,
  contarClasica: (base: EstadoCatalogo) => Promise<number>,
): Promise<EstadoCatalogo> {
  const { href } = await destinoDeBusqueda(
    { q, stock: vista.soloStock ? undefined : "todos" },
    {
      habilitada: async () => true,
      plan: async () => (plan ? { plan, msJev: null } : null),
      contarClasica,
    },
  );
  const url = new URL(href, "https://tienda.example");
  const params: Record<string, string | string[]> = {};
  for (const clave of new Set(url.searchParams.keys())) {
    const valores = url.searchParams.getAll(clave);
    params[clave] = valores.length > 1 ? valores : valores[0];
  }
  return leerEstado(params);
}

/** El conteo clásico de hoy: los campos viejos (`busqueda`) de `filtrosDeEstado`. */
export const contarClasicaViejo = (vista: VistaBanco) => (base: EstadoCatalogo) =>
  contarCatalogo({ soloVisibles: vista.soloVisibles, filtros: filtrosDeEstado(base) });
