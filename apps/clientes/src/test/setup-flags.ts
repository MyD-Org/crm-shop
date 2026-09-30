import { beforeEach, vi } from "vitest";
import { estadoFlags, reiniciarFlags } from "./flags";

vi.mock("@/flags", () => ({
  pagosFlag: async () => estadoFlags().pagos,
  cuotasFlag: async () => estadoFlags().cuotas,
  catalogoSoloVisiblesFlag: async () => estadoFlags()["catalogo-solo-visibles"],
  envioFlag: async () => estadoFlags().envio,
  sucursalesFlag: async () => estadoFlags().sucursales,
  disponibilidadSucursalFlag: async () => estadoFlags()["disponibilidad-sucursal"],
  chatIaFlag: async () => estadoFlags()["chat-ia"],
  trackingFlag: async () => estadoFlags().tracking,
}));

beforeEach(() => {
  reiniciarFlags();
});
