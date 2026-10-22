import { esAdmin } from "@/lib/auth";
import { HabilitarEdicion } from "@/components/home/HabilitarEdicion";
import type { BloqueMarca } from "@/lib/marcas/pagina-marca";
import { BarraEdicionMarca } from "./BarraEdicionMarca";

/**
 * Hueco del editor de una página de marca (server), como `EdicionSiAdmin` de
 * la home: va dentro de `<Suspense fallback={null}>`, así al visitante no le
 * llega nada del editor.
 */
export async function EdicionMarcaSiAdmin({
  slug,
  publicada,
  bloques,
}: {
  slug: string;
  publicada: boolean;
  /** Los bloques en el orden vigente (para "Ordenar secciones"). */
  bloques: BloqueMarca[];
}) {
  if (!(await esAdmin())) return null;
  return (
    <>
      <HabilitarEdicion />
      <BarraEdicionMarca slug={slug} publicada={publicada} bloques={bloques} />
    </>
  );
}
