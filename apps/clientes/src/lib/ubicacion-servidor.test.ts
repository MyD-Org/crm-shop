import { beforeEach, describe, expect, it, vi } from "vitest";
import { estadoFlags } from "@/test/flags";
import { claveProvincia } from "./sucursales";

/**
 * Resolución de la elección de ubicación en el servidor: la cookie se valida SIEMPRE contra el
 * dueño (direcciones del usuario) y contra las sucursales vigentes. Lo ajeno, borrado o stale se
 * ignora y cae a la predeterminada o a "ninguna"; nunca implícitamente a "retiro".
 */

let cookieValor: string | undefined;
let clerkUserId: string | null = null;
let nombrePila: string | null = null;

const DIR_A = "0b8f7d1e-7c55-4a38-9d0e-2c1f7f6b9a10";
const DIR_B = "1c9f8e2f-8d66-4b49-8e1f-3d2f8f7c0b21";
const AJENA = "2dafaf30-9e77-4c5a-9f20-4e3f9f8d1c32";

const direccion = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  etiqueta: "Casa",
  calle: "Calle Falsa 123",
  ciudad: "Posadas",
  provincia: "Misiones",
  cp: "3300",
  referencias: null,
  predeterminada: false,
  ...extra,
});

let direcciones: ReturnType<typeof direccion>[] = [];
const listarDirecciones = vi.fn<(...a: unknown[]) => Promise<typeof direcciones>>(async () => direcciones);

const suc = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  nombre: `Local ${slug}`,
  ciudad: "Ciudad Ejemplo",
  provincia: "Córdoba",
  direccion: "Calle 1",
  horario: "",
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden: 0,
  activa: true,
  predeterminada: false,
  ...extra,
});
let sucursales: ReturnType<typeof suc>[] = [];
const sucursalesCacheadas = vi.fn(async () => ({ sucursales, zonas: [] }));
const localesDeRetiro = vi.fn(async () => []);

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "shop_ubicacion" && cookieValor ? { value: cookieValor } : undefined),
  }),
}));
vi.mock("./auth", () => ({ identidadActual: async () => ({ clerkUserId, nombrePila }) }));
vi.mock("./direcciones-envio-db", () => ({ listarDirecciones: (...a: unknown[]) => listarDirecciones(...a) }));
vi.mock("./sucursales-datos", () => ({ sucursalesCacheadas: () => sucursalesCacheadas() }));
vi.mock("./zona-servidor", () => ({ localesDeRetiro: () => localesDeRetiro() }));

import { ubicacionDelVisitante } from "./ubicacion-servidor";

const MISIONES = claveProvincia("Misiones");
const cookie = (o: unknown) => {
  cookieValor = JSON.stringify(o);
};

beforeEach(() => {
  cookieValor = undefined;
  clerkUserId = null;
  nombrePila = null;
  direcciones = [];
  sucursales = [suc("sucursal-a"), suc("sucursal-b", { nombre: "Local B" })];
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  estadoFlags().sucursales = true;
});

describe("direccionId contra el dueño", () => {
  it("dirección propia => envío con esa dirección", async () => {
    clerkUserId = "user_1";
    nombrePila = "Ana";
    direcciones = [direccion(DIR_A, { predeterminada: true }), direccion(DIR_B, { calle: "Otra 9", ciudad: "Oberá" })];
    cookie({ tipo: "envio", localidad: "Oberá", provincia: MISIONES, direccionId: DIR_B });
    const r = await ubicacionDelVisitante();
    expect(r.eleccion).toMatchObject({ tipo: "envio", direccion: { id: DIR_B, calle: "Otra 9" } });
    expect(r.nombrePila).toBe("Ana");
    expect(r.origen).toBe("cookie");
    expect(r.ubicacion).toMatchObject({ localidad: "Oberá", provincia: MISIONES });
  });

  it("ajena o borrada => ignora la cookie y cae a la predeterminada, sin filtrar datos ajenos", async () => {
    clerkUserId = "user_1";
    direcciones = [direccion(DIR_A, { predeterminada: true, calle: "Mía 1" })];
    cookie({ tipo: "envio", localidad: "Rosario", provincia: claveProvincia("Santa Fe"), cp: "2000", direccionId: AJENA });
    const r = await ubicacionDelVisitante();
    expect(r.eleccion).toMatchObject({ tipo: "envio", direccion: { id: DIR_A, calle: "Mía 1" } });
    expect(JSON.stringify(r)).not.toContain("Rosario");
    expect(JSON.stringify(r)).not.toContain("2000");
  });

  it("ajena y el usuario no tiene direcciones => ninguna", async () => {
    clerkUserId = "user_1";
    cookie({ tipo: "envio", localidad: "Rosario", provincia: claveProvincia("Santa Fe"), direccionId: AJENA });
    const r = await ubicacionDelVisitante();
    expect(r.eleccion).toEqual({ tipo: "ninguna" });
    expect(r.ubicacion).toBeNull();
    expect(r.origen).toBe("ninguna");
  });

  it("logout con direccionId => ignora el id pero usa localidad/provincia válidas como envío", async () => {
    cookie({ tipo: "envio", localidad: "Posadas", provincia: MISIONES, cp: "3300", direccionId: DIR_A });
    const r = await ubicacionDelVisitante();
    expect(r.eleccion).toEqual({ tipo: "envio", localidad: "Posadas", provincia: MISIONES, cp: "3300" });
    expect(listarDirecciones).not.toHaveBeenCalled();
  });
});

describe("retiro contra las sucursales", () => {
  it("slug válido (activa + aceptaRetiro) => retiro con sucursal y ubicación derivada de la sucursal", async () => {
    cookie({ tipo: "retiro", sucursal: "sucursal-a" });
    const r = await ubicacionDelVisitante();
    expect(r.eleccion).toEqual({
      tipo: "retiro",
      sucursal: { slug: "sucursal-a", nombre: "Local sucursal-a", ciudad: "Ciudad Ejemplo", provincia: "Córdoba" },
    });
    expect(r.ubicacion).toMatchObject({ localidad: "Ciudad Ejemplo", provincia: claveProvincia("Córdoba") });
    expect(r.origen).toBe("cookie");
  });

  it("inexistente, inactiva o sin retiro => fallback (predeterminada o ninguna)", async () => {
    sucursales = [suc("sucursal-a", { activa: false }), suc("sucursal-b", { aceptaRetiro: false })];
    for (const sucursal of ["no-existe", "sucursal-a", "sucursal-b"]) {
      cookie({ tipo: "retiro", sucursal });
      expect((await ubicacionDelVisitante()).eleccion).toEqual({ tipo: "ninguna" });
    }
    clerkUserId = "user_1";
    direcciones = [direccion(DIR_A, { predeterminada: true })];
    cookie({ tipo: "retiro", sucursal: "no-existe" });
    expect((await ubicacionDelVisitante()).eleccion).toMatchObject({ tipo: "envio", direccion: { id: DIR_A } });
  });

  it("flag sucursales apagado: retiro sin slug vale como local único; un slug se descarta", async () => {
    estadoFlags().sucursales = false;
    cookie({ tipo: "retiro" });
    const r = await ubicacionDelVisitante();
    expect(r.eleccion).toEqual({ tipo: "retiro", sucursal: null });
    expect(sucursalesCacheadas).not.toHaveBeenCalled();
    cookie({ tipo: "retiro", sucursal: "sucursal-a" });
    expect((await ubicacionDelVisitante()).eleccion).toEqual({ tipo: "ninguna" });
  });

  it("flag sucursales encendido y retiro sin slug => descartado", async () => {
    cookie({ tipo: "retiro" });
    expect((await ubicacionDelVisitante()).eleccion).toEqual({ tipo: "ninguna" });
  });

  it("disponibilidad-sucursal apagado: se valida con sucursalesCacheadas, no con localesDeRetiro", async () => {
    estadoFlags()["disponibilidad-sucursal"] = false;
    cookie({ tipo: "retiro", sucursal: "sucursal-b" });
    const r = await ubicacionDelVisitante();
    expect(r.eleccion).toMatchObject({ tipo: "retiro", sucursal: { slug: "sucursal-b" } });
    expect(localesDeRetiro).not.toHaveBeenCalled();
  });

  it("error al leer las sucursales => fallback, con log", async () => {
    sucursalesCacheadas.mockRejectedValueOnce(new Error("db caída"));
    cookie({ tipo: "retiro", sucursal: "sucursal-a" });
    const r = await ubicacionDelVisitante();
    expect(r.eleccion).toEqual({ tipo: "ninguna" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("sin cookie", () => {
  it("con sesión => predeterminada (o primera) como envío", async () => {
    clerkUserId = "user_1";
    direcciones = [direccion(DIR_B), direccion(DIR_A, { predeterminada: true })];
    const r = await ubicacionDelVisitante();
    expect(r.eleccion).toMatchObject({ tipo: "envio", direccion: { id: DIR_A } });
    expect(r.origen).toBe("direccion");
    direcciones = [direccion(DIR_B)];
    expect((await ubicacionDelVisitante()).eleccion).toMatchObject({ direccion: { id: DIR_B } });
  });

  it("sin sesión => ninguna, nunca retiro", async () => {
    const r = await ubicacionDelVisitante();
    expect(r.eleccion).toEqual({ tipo: "ninguna" });
    expect(r.ubicacion).toBeNull();
  });

  it("error al listar direcciones => ninguna con log, sin lanzar", async () => {
    clerkUserId = "user_1";
    listarDirecciones.mockRejectedValueOnce(new Error("db"));
    const r = await ubicacionDelVisitante();
    expect(r.eleccion).toEqual({ tipo: "ninguna" });
    expect(console.error).toHaveBeenCalled();
  });

  it("formato viejo de cookie => envío sin cp", async () => {
    cookie({ localidad: "Posadas", provincia: MISIONES, id: "123" });
    const r = await ubicacionDelVisitante();
    expect(r.eleccion).toEqual({ tipo: "envio", localidad: "Posadas", provincia: MISIONES });
    expect(r.ubicacion).toEqual({ localidad: "Posadas", provincia: MISIONES, id: "123" });
  });
});
