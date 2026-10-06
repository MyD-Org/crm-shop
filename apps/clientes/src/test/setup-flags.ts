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
  busquedaMedidasFlag: async () => estadoFlags()["busqueda-medidas"],
  catalogoFacetasPorTipoFlag: async () => estadoFlags()["catalogo-facetas-por-tipo"],
}));

// Por defecto nadie tiene lista privada: los tests de rutas no dependen de la DB ni de la sesión para
// resolverla. Los que la necesitan vuelven a mockear este módulo con su propia fábrica.
vi.mock("@/lib/lista-cuenta-repo", () => ({
  listaPrivadaDelComprador: async () => null,
  listaPrivadaDeContacto: async () => null,
  listaMapeada: async () => null,
}));

beforeEach(() => {
  reiniciarFlags();
});
