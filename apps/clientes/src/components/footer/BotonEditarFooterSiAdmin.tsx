import type { DatosFooter } from "@/data/footer";
import { esAdmin } from "@/lib/auth";
import { BotonEditarFooter } from "./BotonEditarFooter";

/**
 * Hueco del botón "Editar footer" (server). `SiteFooter` lo monta dentro de un
 * `<Suspense fallback={null}>`: el footer va en el shell estático y no
 * calcula `esAdmin()`; al visitante no le llega ningún control. Los datos los
 * pasa el padre (los mismos que pinta el footer).
 */
export async function BotonEditarFooterSiAdmin({ inicial }: { inicial: DatosFooter }) {
  if (!(await esAdmin())) return null;
  return (
    <div data-editor="" className="mx-auto flex w-full max-w-[1280px] justify-end px-4 pt-6">
      <BotonEditarFooter inicial={inicial} />
    </div>
  );
}
