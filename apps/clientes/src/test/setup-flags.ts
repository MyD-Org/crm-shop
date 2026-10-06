import { beforeEach, vi } from "vitest";
import { estadoFlags, reiniciarFlags } from "./flags";

vi.mock("@/flags", () => ({
  cuotasFlag: async () => estadoFlags().cuotas,
  catalogoSoloVisiblesFlag: async () => estadoFlags()["catalogo-solo-visibles"],
  sucursalesFlag: async () => estadoFlags().sucursales,
  disponibilidadSucursalFlag: async () => estadoFlags()["disponibilidad-sucursal"],
  chatIaFlag: async () => estadoFlags()["chat-ia"],
  busquedaIaFlag: async () => estadoFlags()["busqueda-ia"],
  trackingFlag: async () => estadoFlags().tracking,
  precioEspecialCuentaFlag: async () => estadoFlags()["precio-especial-cuenta"],
  busquedaMotorUnicoFlag: async () => estadoFlags()["busqueda-motor-unico"],
}));

beforeEach(() => {
  reiniciarFlags();
});
