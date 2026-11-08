import { describe, expect, it, vi } from "vitest";
import { correr, migrarImagen, conteoVacio } from "./home-variantes-800";

const ID = "48d9ae91-da35-476b-9aaa-c8306efd9b49";
const BASE = "https://medios.plataforma.example/";
const vieja = `${BASE}home/central-led/${ID}-1600.webp`;
const K_VIEJA = `home/central-led/${ID}-1600.webp`;
const K_1600 = `home/central-led/v/${ID}-1600.webp`;
const K_800 = `home/central-led/v/${ID}-800.webp`;

function r2Falso(existentes: Record<string, Uint8Array>) {
  const guardado: Record<string, Uint8Array> = {};
  return {
    guardado,
    r2: {
      head: vi.fn(async (k: string) => (k in existentes ? { size: 1, contentType: "image/webp", etag: null } : null)),
      getObject: vi.fn(async (k: string) => existentes[k] ?? null),
      put: vi.fn(async (k: string, b: Uint8Array) => {
        guardado[k] = b;
      }),
    },
  };
}
const redim = async () => new Uint8Array([8, 0, 0]);

describe("migrarImagen", () => {
  it("dry-run: cuenta sin escribir", async () => {
    const { r2 } = r2Falso({ [K_VIEJA]: new Uint8Array([1]) });
    const c = conteoVacio();
    const ok = await migrarImagen(r2, { base: BASE, tenant: "central-led", id: ID }, c, { ejecutar: false, redimensionar: redim });
    expect(ok).toBe(true);
    expect(c).toMatchObject({ copiadas1600: 1, generadas800: 1 });
    expect(r2.put).not.toHaveBeenCalled();
  });

  it("ejecutar: copia la 1600 y genera la 800 en la ruta nueva", async () => {
    const { r2, guardado } = r2Falso({ [K_VIEJA]: new Uint8Array([1]) });
    await migrarImagen(r2, { base: BASE, tenant: "central-led", id: ID }, conteoVacio(), { ejecutar: true, redimensionar: redim });
    expect(Object.keys(guardado).sort()).toEqual([K_1600, K_800].sort());
    expect(Array.from(guardado[K_1600])).toEqual([1]);
    expect(Array.from(guardado[K_800])).toEqual([8, 0, 0]);
  });

  it("si ya existen las dos, no baja ni sube nada", async () => {
    const { r2 } = r2Falso({ [K_1600]: new Uint8Array([1]), [K_800]: new Uint8Array([1]) });
    const c = conteoVacio();
    expect(await migrarImagen(r2, { base: BASE, tenant: "central-led", id: ID }, c, { ejecutar: true, redimensionar: redim })).toBe(true);
    expect(c.yaExistian).toBe(1);
    expect(r2.getObject).not.toHaveBeenCalled();
  });

  it("original ausente ⇒ false", async () => {
    const { r2 } = r2Falso({});
    const c = conteoVacio();
    expect(await migrarImagen(r2, { base: BASE, tenant: "central-led", id: ID }, c, { ejecutar: true, redimensionar: redim })).toBe(false);
    expect(c.faltanEnBucket).toBe(1);
  });
});

describe("correr", () => {
  it("dry-run no escribe la base; ejecutar reescribe las filas con URL vieja", async () => {
    const { r2 } = r2Falso({ [K_VIEJA]: new Uint8Array([1]) });
    const actualizarFila = vi.fn(async () => true);
    const filas = [
      { key: "hero", payload: { imagen: vieja } },
      { key: "anuncio", payload: { texto: "hola" } },
    ];
    const deps = { r2, leerFilas: async () => filas, actualizarFila, redimensionar: redim };

    const seco = await correr(deps, false, () => {});
    expect(seco).toMatchObject({ filas: 2, filasConCambios: 1, filasActualizadas: 0 });
    expect(actualizarFila).not.toHaveBeenCalled();

    const real = await correr(deps, true, () => {});
    expect(real.filasActualizadas).toBe(1);
    expect(actualizarFila).toHaveBeenCalledWith("hero", { imagen: vieja }, { imagen: `${BASE}${K_1600}` });
  });

  it("no reescribe una fila si falta la original; informa conflicto si la fila cambió", async () => {
    const sin = r2Falso({});
    const act = vi.fn(async () => true);
    const c1 = await correr({ r2: sin.r2, leerFilas: async () => [{ key: "hero", payload: { i: vieja } }], actualizarFila: act, redimensionar: redim }, true, () => {});
    expect(c1.filasConError).toBe(1);
    expect(act).not.toHaveBeenCalled();

    const con = r2Falso({ [K_VIEJA]: new Uint8Array([1]) });
    const c2 = await correr({ r2: con.r2, leerFilas: async () => [{ key: "hero", payload: { i: vieja } }], actualizarFila: async () => false, redimensionar: redim }, true, () => {});
    expect(c2.filasConflicto).toBe(1);
  });
});
