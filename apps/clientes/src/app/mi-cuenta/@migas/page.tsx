import { MigasMiCuenta } from "@/components/mi-cuenta/MigasMiCuenta";
import { migasMiCuenta, RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

/** Migas del resumen: Inicio / Mi cuenta. */
export default function MigasResumen() {
  return <MigasMiCuenta items={migasMiCuenta(RUTAS_MI_CUENTA.resumen)} />;
}
