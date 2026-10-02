import { beforeEach, describe, expect, it, vi } from "vitest";
import { estadoFlags } from "@/test/flags";

/**
 * Consumo de la elección en la zona/disponibilidad: el retiro elegido fija la sucursal del
 * visitante; el catálogo cacheado (`dispCatalogo`) NO depende de la elección.
 */

const suc = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  nombre: `Local ${slug}`,
  ciudad: "Ciudad Ejemplo",
  provincia: "Misiones",
  direccion: "Calle 1",
  horario: "",
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden: 1,
  activa: true,
  predeterminada: false,
  ...extra,
});
const datos = {
  sucursales: [suc("sede-a"), suc("sede-b", { orden: 2, predeterminada: true })],
  zonas: [{ id: "z1", provinciaClave: "misiones", sucursal: "sede-b", facturaSucursal: null }],
};

type Eleccion = { tipo: "envio" | "retiro" | "ninguna"; sucursal?: { slug: string } | null };
let resuelta: { ubicacion: { localidad: string; provincia: string } | null; eleccion: Eleccion };
const ubicacionDelVisitante = vi.fn(async () => resuelta);

vi.mock("./ubicacion-servidor", () => ({ ubicacionDelVisitante: () => ubicacionDelVisitante() }));
vi.mock("./auth", () => ({ identidadActual: async () => ({ clerkUserId: null }) }));
vi.mock("./facturacion-db", () => ({ getPerfilFacturacion: async () => null }));
vi.mock("./sucursales-datos", () => ({
  sucursalesCacheadas: async () => datos,
  reglasVentaCacheadas: async () => ({}),
}));

import { dispCatalogo, dispDelVisitante, opcionesCheckoutDelVisitante, zonaDelVisitante } from "./zona-servidor";

beforeEach(() => {
  vi.clearAllMocks();
  estadoFlags().sucursales = true;
  estadoFlags()["disponibilidad-sucursal"] = true;
});

const misiones = { localidad: "Posadas", provincia: "misiones" };

describe("retiro elegido fija la sucursal", () => {
  it("retiro en A con provincia atendida por B => la zona es A", async () => {
    resuelta = { ubicacion: misiones, eleccion: { tipo: "retiro", sucursal: { slug: "sede-a" } } };
    expect((await zonaDelVisitante())?.sucursal?.slug).toBe("sede-a");
  });

  it("envío a esa provincia => la zona es B (comportamiento actual)", async () => {
    resuelta = { ubicacion: misiones, eleccion: { tipo: "envio" } };
    expect((await zonaDelVisitante())?.sucursal?.slug).toBe("sede-b");
  });

  it("la disponibilidad del visitante sigue al local elegido", async () => {
    resuelta = { ubicacion: misiones, eleccion: { tipo: "retiro", sucursal: { slug: "sede-a" } } };
    expect((await dispDelVisitante())?.zona).toBe("sede-a");
  });

  it("el checkout preselecciona el local elegido", async () => {
    resuelta = { ubicacion: misiones, eleccion: { tipo: "retiro", sucursal: { slug: "sede-a" } } };
    expect((await opcionesCheckoutDelVisitante())?.localInicial).toBe("sede-a");
  });

  it("retiro del local único (sin sucursal) no cambia la zona", async () => {
    resuelta = { ubicacion: misiones, eleccion: { tipo: "retiro", sucursal: null } };
    expect((await zonaDelVisitante())?.sucursal?.slug).toBe("sede-b");
  });

  it("flag sucursales apagado => sin zona", async () => {
    estadoFlags().sucursales = false;
    resuelta = { ubicacion: misiones, eleccion: { tipo: "retiro", sucursal: { slug: "sede-a" } } };
    expect(await zonaDelVisitante()).toBeNull();
  });
});

describe("dispCatalogo no depende de la elección", () => {
  it("no lee la ubicación y es idéntico con o sin retiro", async () => {
    resuelta = { ubicacion: misiones, eleccion: { tipo: "retiro", sucursal: { slug: "sede-a" } } };
    const conRetiro = await dispCatalogo();
    expect(ubicacionDelVisitante).not.toHaveBeenCalled();
    resuelta = { ubicacion: null, eleccion: { tipo: "ninguna" } };
    expect(await dispCatalogo()).toEqual(conRetiro);
  });
});
