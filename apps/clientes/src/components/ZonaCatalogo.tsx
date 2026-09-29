import { zonaDelVisitante } from "@/lib/zona-servidor";
import { PROVINCIAS_SELECTOR } from "@/lib/zona";
import { SelectorZona } from "./SelectorZona";

/**
 * Zona del visitante sobre el catálogo. Hueco por request (lee cookie e identidad): con el flag
 * `sucursales` apagado, o sin sucursales cargadas, no renderiza nada.
 */
export async function ZonaCatalogo() {
  const zona = await zonaDelVisitante();
  if (!zona) return null;
  return (
    <div className="mx-auto w-full max-w-contenido px-4 pt-4">
      <SelectorZona
        provincias={PROVINCIAS_SELECTOR}
        actual={zona.provinciaClave}
        sucursal={zona.sucursal?.nombre ?? null}
      />
    </div>
  );
}
