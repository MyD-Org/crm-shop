import type { DatosLegales } from "@/data/home-defaults";
import { esAdmin } from "@/lib/auth";
import { BotonDatosLegales } from "./BotonDatosLegales";

/**
 * Hueco del botón "Editar datos legales" (server). `PaginaLegal` lo monta
 * dentro de un `<Suspense fallback={null}>`: la página legal no calcula
 * `esAdmin()` y al visitante no le llega ningún control. Los datos los pasa
 * el padre (los mismos que pinta la página).
 */
export async function BotonDatosLegalesSiAdmin({ datos }: { datos: DatosLegales }) {
  if (!(await esAdmin())) return null;
  return <BotonDatosLegales inicial={datos} />;
}
