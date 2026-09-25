import type { DatosLegales, MapaVisibilidad } from "@/data/home-defaults";
import { esAdmin } from "@/lib/auth";
import { BarraEdicion } from "./BarraEdicion";
import { HabilitarEdicion } from "./HabilitarEdicion";

/**
 * Hueco del editor de la home (server). `page.tsx` lo monta dentro de un
 * `<Suspense fallback={null}>`: la home se arma sin esperar a `esAdmin()` y
 * al visitante no le llega nada del editor (ni barra ni datos). Los datos de
 * cada sección los pide el Dialog al abrirse (`leerSeccionParaEditar`); acá
 * solo viaja lo que la barra muestra, y lo pasa el padre (no se relee
 * home_content dentro del hueco).
 */
export async function EdicionSiAdmin({
  visibilidad,
  legal,
}: {
  visibilidad: MapaVisibilidad;
  legal: DatosLegales;
}) {
  if (!(await esAdmin())) return null;
  return (
    <>
      <HabilitarEdicion />
      <BarraEdicion visibilidad={visibilidad} legal={legal} />
    </>
  );
}
