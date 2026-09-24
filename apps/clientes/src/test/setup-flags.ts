import { beforeEach, vi } from "vitest";
import { estadoFlags, reiniciarFlags } from "./flags";

vi.mock("@/flags", () => ({
  pagosFlag: async () => estadoFlags().pagos,
  cuotasFlag: async () => estadoFlags().cuotas,
  catalogoSoloVisiblesFlag: async () => estadoFlags()["catalogo-solo-visibles"],
  envioFlag: async () => estadoFlags().envio,
  chatIaFlag: async () => estadoFlags()["chat-ia"],
}));

beforeEach(() => {
  reiniciarFlags();
});
