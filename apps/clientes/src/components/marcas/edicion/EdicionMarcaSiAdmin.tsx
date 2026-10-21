import { esAdmin } from "@/lib/auth";
import { HabilitarEdicion } from "@/components/home/HabilitarEdicion";
import { BarraEdicionMarca } from "./BarraEdicionMarca";

/**
 * Hueco del editor de una página de marca (server), como `EdicionSiAdmin` de
 * la home: va dentro de `<Suspense fallback={null}>`, así al visitante no le
 * llega nada del editor.
 */
export async function EdicionMarcaSiAdmin({ slug, publicada }: { slug: string; publicada: boolean }) {
  if (!(await esAdmin())) return null;
  return (
    <>
      <HabilitarEdicion />
      <BarraEdicionMarca slug={slug} publicada={publicada} />
    </>
  );
}
