import { MigasMiCuenta } from "@/components/mi-cuenta/MigasMiCuenta";
import { migasMiCuenta, RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

// Mismo modo que las páginas del segmento: todo Mi cuenta es dinámico.
export const dynamic = "force-dynamic";

/** Migas del resumen: Inicio / Mi cuenta. */
export default function MigasResumen() {
  return <MigasMiCuenta items={migasMiCuenta(RUTAS_MI_CUENTA.resumen)} />;
}
