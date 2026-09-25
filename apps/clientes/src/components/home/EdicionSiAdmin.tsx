import type { MapaVisibilidad } from "@/data/home-defaults";
import { esAdmin } from "@/lib/auth";
import { getDatosFooter, getDatosLegales } from "@/lib/home-datos";
import { BarraEdicion } from "./BarraEdicion";
import { HabilitarEdicion } from "./HabilitarEdicion";

/**
 * Hueco del editor de la home (server). `page.tsx` lo monta dentro de un
 * `<Suspense fallback={null}>`: la home se arma sin esperar a `esAdmin()` y
 * al visitante no le llega nada del editor (ni barra ni datos). Los datos de
 * cada sección los pide el Dialog al abrirse (`leerSeccionParaEditar`); acá
 * solo viaja lo que la barra muestra. Datos legales y footer los pide el hueco
 * sólo para el admin: el footer del layout ya los leyó en este request (React
 * `cache`), así que no suman consultas.
 */
export async function EdicionSiAdmin({
  visibilidad,
}: {
  visibilidad: MapaVisibilidad;
}) {
  if (!(await esAdmin())) return null;
  const [legal, footer] = await Promise.all([getDatosLegales(), getDatosFooter()]);
  return (
    <>
      <HabilitarEdicion />
      <BarraEdicion visibilidad={visibilidad} legal={legal} footer={footer} />
    </>
  );
}
