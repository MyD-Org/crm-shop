import { MigasMiCuenta } from "@/components/mi-cuenta/MigasMiCuenta";
import { migasMiCuenta, RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

export const dynamic = "force-dynamic";

/** Migas de cualquier sección de Mi cuenta, armadas desde la ruta. */
export default async function MigasSeccion({ params }: { params: Promise<{ ruta: string[] }> }) {
  const { ruta } = await params;
  return <MigasMiCuenta items={migasMiCuenta(`${RUTAS_MI_CUENTA.resumen}/${ruta.join("/")}`)} />;
}
