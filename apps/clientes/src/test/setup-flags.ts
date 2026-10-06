import { beforeEach, vi } from "vitest";
import { estadoFlags, reiniciarFlags } from "./flags";

vi.mock("@/flags", () => ({
  cuotasCobroFlag: async () => estadoFlags()["cuotas-cobro"],
  catalogoSoloVisiblesFlag: async () => estadoFlags()["catalogo-solo-visibles"],
  sucursalesFlag: async () => estadoFlags().sucursales,
  disponibilidadSucursalFlag: async () => estadoFlags()["disponibilidad-sucursal"],
  chatIaFlag: async () => estadoFlags()["chat-ia"],
  busquedaIaFlag: async () => estadoFlags()["busqueda-ia"],
  trackingFlag: async () => estadoFlags().tracking,
  precioEspecialCuentaFlag: async () => estadoFlags()["precio-especial-cuenta"],
  busquedaMedidasFlag: async () => estadoFlags()["busqueda-medidas"],
}));

beforeEach(() => {
  reiniciarFlags();
});
