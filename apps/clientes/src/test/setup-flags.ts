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
  variantesSelectorFlag: async () => estadoFlags()["variantes-selector"],
}));

// Por defecto nadie tiene lista privada: los tests de rutas no dependen de la DB ni de la sesión para
// resolverla. Los que la necesitan vuelven a mockear este módulo con su propia fábrica.
vi.mock("@/lib/lista-cuenta-repo", () => ({
  listaPrivadaDelComprador: async () => null,
  listaPrivadaDeContacto: async () => null,
  listaMapeada: async () => null,
}));

// Por defecto la marca es la de Central (`getMarca` va a la base con `'use cache'`, que fuera de Next
// no existe): los tests de rutas y mails no dependen de la DB para obtenerla. `marca-datos.test.ts`
// prueba la lectura real con `vi.unmock`.
vi.mock("@/lib/marca", async () => {
  const base = await import("@/lib/marca-base");
  return { ...base, getMarca: vi.fn(async () => base.MARCA_POR_DEFECTO) };
});

// Ídem para el tema: por defecto el de Central (sin paleta propia). `tema-tenant-datos.test.ts` prueba
// la lectura real con `vi.unmock`.
vi.mock("@/lib/tema-tenant-datos", async () => {
  const base = await import("@/lib/tema-tenant");
  return { getTemaTenant: vi.fn(async () => base.sanearTemaTenant(null)) };
});

beforeEach(() => {
  reiniciarFlags();
});
