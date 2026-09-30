import { beforeEach, vi } from "vitest";
import { estadoFlags, reiniciarFlags } from "./flags";

vi.mock("@/flags", () => ({
  pagosFlag: async () => estadoFlags().pagos,
  cuotasFlag: async () => estadoFlags().cuotas,
  catalogoSoloVisiblesFlag: async () => estadoFlags()["catalogo-solo-visibles"],
  envioFlag: async () => estadoFlags().envio,
  sucursalesFlag: async () => estadoFlags().sucursales,
  disponibilidadSucursalFlag: async () => estadoFlags()["disponibilidad-sucursal"],
  pedidoAConfirmarFlag: async () => estadoFlags()["pedido-a-confirmar"],
  chatIaFlag: async () => estadoFlags()["chat-ia"],
  busquedaIaFlag: async () => estadoFlags()["busqueda-ia"],
  trackingFlag: async () => estadoFlags().tracking,
}));

beforeEach(() => {
  reiniciarFlags();
});
