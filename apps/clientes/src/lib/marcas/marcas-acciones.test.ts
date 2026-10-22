import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  esAdmin: vi.fn(),
  guardar: vi.fn(),
  borrar: vi.fn(),
  leer: vi.fn(),
  leerPrefijo: vi.fn(),
  updateTag: vi.fn(),
  valores: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ esAdmin: m.esAdmin }));
vi.mock("@/lib/home-guardar", () => ({
  guardarSeccionHome: m.guardar,
  borrarSeccionHome: m.borrar,
  leerSeccionHome: m.leer,
  leerSeccionesHomePorPrefijo: m.leerPrefijo,
}));
vi.mock("next/cache", () => ({ updateTag: m.updateTag }));
vi.mock("@/lib/catalog", () => ({ getValoresMarca: m.valores }));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: async () => ({ soloVisibles: true }) }));
vi.mock("@/lib/catalogo-medios", () => ({ hostsDeMedios: () => ["media.cliente.example"] }));

import {
  borrarPaginaMarca,
  cambiarVisibilidadBloqueMarca,
  crearPaginaMarca,
  guardarBloqueMarca,
  guardarDatosMarca,
  guardarEncabezadoMarca,
  guardarOrdenMarca,
  leerPaginaMarcaParaEditar,
  leerPaginasMarcaParaEditor,
  moverPaginaMarca,
  valoresMarcaParaEditor,
} from "./marcas-acciones";

const SIN_PERMISO = "No tiene permiso para editar las marcas.";

const fila = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  nombre: slug,
  nivel: "oficial",
  publicada: false,
  orden: 1,
  marcasCatalogo: ["ACME"],
  bajada: "",
  bloques: {},
  visibilidad: {},
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.esAdmin.mockResolvedValue(true);
  m.guardar.mockResolvedValue({ updatedAt: new Date() });
  m.leer.mockResolvedValue(undefined);
  m.leerPrefijo.mockResolvedValue(new Map());
});

describe("permisos", () => {
  it("sin admin ninguna acción escribe ni lee", async () => {
    m.esAdmin.mockResolvedValue(false);
    const resultados = await Promise.all([
      crearPaginaMarca({ nombre: "Acme", slug: "acme", nivel: "marca", marcasCatalogo: ["ACME"] }),
      guardarDatosMarca("acme", {}),
      guardarBloqueMarca("acme", "hero", {}),
      cambiarVisibilidadBloqueMarca("acme", "hero", "nunca"),
      moverPaginaMarca("acme", "arriba"),
      borrarPaginaMarca("acme"),
    ]);
    for (const r of resultados) expect(r).toEqual({ ok: false, errores: [SIN_PERMISO] });
    expect((await leerPaginasMarcaParaEditor()).ok).toBe(false);
    expect((await leerPaginaMarcaParaEditar("acme")).ok).toBe(false);
    expect((await valoresMarcaParaEditor()).ok).toBe(false);
    expect(m.guardar).not.toHaveBeenCalled();
    expect(m.borrar).not.toHaveBeenCalled();
    expect(m.valores).not.toHaveBeenCalled();
  });
});

describe("crearPaginaMarca", () => {
  it("crea oculta, al final del orden y con el contenido inicial", async () => {
    m.leerPrefijo.mockResolvedValue(new Map([["pagina-marca:otra", fila("otra", { orden: 4 })]]));
    const r = await crearPaginaMarca({ nombre: "Acme", slug: "acme", nivel: "oficial", marcasCatalogo: ["ACME"] });
    expect(r).toEqual({ ok: true });
    const [clave, payload] = m.guardar.mock.calls[0];
    expect(clave).toBe("pagina-marca:acme");
    expect(payload).toMatchObject({ slug: "acme", publicada: false, orden: 5, nivel: "oficial" });
    expect(payload.bloques.cotizacion.mensaje).toBe("Hola, quiero cotizar una obra con productos Acme.");
    expect(m.updateTag).toHaveBeenCalledWith("home");
  });

  it("rechaza un slug que ya existe", async () => {
    m.leerPrefijo.mockResolvedValue(new Map([["pagina-marca:acme", fila("acme")]]));
    const r = await crearPaginaMarca({ nombre: "Acme", slug: "acme", nivel: "marca", marcasCatalogo: ["ACME"] });
    expect(r).toEqual({ ok: false, errores: ["Ya existe una página con esa dirección."] });
    expect(m.guardar).not.toHaveBeenCalled();
  });

  it("valida los datos (sin valores de marca)", async () => {
    const r = await crearPaginaMarca({ nombre: "Acme", slug: "acme", nivel: "marca", marcasCatalogo: [] });
    expect(r.ok).toBe(false);
    expect(m.guardar).not.toHaveBeenCalled();
  });
});

describe("guardar", () => {
  it("guardarBloqueMarca reemplaza solo ese bloque en la fila", async () => {
    m.leer.mockResolvedValue(fila("acme", { bloques: { componentes: { titulo: "Viejo", chips: ["A"] } } }));
    const r = await guardarBloqueMarca("acme", "cotizacion", {
      titulo: "Obras",
      boton: "Cotizar",
      mensaje: "Hola",
    });
    expect(r).toEqual({ ok: true });
    const [, payload] = m.guardar.mock.calls[0];
    expect(payload.bloques.componentes).toEqual({ titulo: "Viejo", chips: ["A"] });
    expect(payload.bloques.cotizacion).toEqual({ titulo: "Obras", boton: "Cotizar", mensaje: "Hola" });
  });

  it("un bloque ajeno al nivel se rechaza", async () => {
    m.leer.mockResolvedValue(fila("acme", { nivel: "marca" }));
    const r = await guardarBloqueMarca("acme", "obras", { titulo: "x", fotos: [] });
    expect(r).toEqual({ ok: false, errores: ["Ese bloque no corresponde a esta página."] });
  });

  it("una página inexistente se informa", async () => {
    const r = await guardarBloqueMarca("nada", "hero", {});
    expect(r).toEqual({ ok: false, errores: ["La página indicada no existe."] });
  });

  it("guardarDatosMarca no deja cambiar el slug y valida", async () => {
    m.leer.mockResolvedValue(fila("acme"));
    const r = await guardarDatosMarca("acme", { slug: "otro", nombre: "Acme SA", publicada: true } as never);
    expect(r).toEqual({ ok: true });
    const [clave, payload] = m.guardar.mock.calls[0];
    expect(clave).toBe("pagina-marca:acme");
    expect(payload).toMatchObject({ slug: "acme", nombre: "Acme SA", publicada: true });
  });

  it("cambiarVisibilidadBloqueMarca guarda la visibilidad del bloque", async () => {
    m.leer.mockResolvedValue(fila("acme"));
    await cambiarVisibilidadBloqueMarca("acme", "obras", "desktop");
    expect(m.guardar.mock.calls[0][1].visibilidad).toEqual({ obras: "desktop" });
  });
});

describe("orden y borrado", () => {
  it("moverPaginaMarca intercambia el orden con la vecina", async () => {
    m.leerPrefijo.mockResolvedValue(
      new Map([
        ["pagina-marca:a", fila("a", { nivel: "marca", orden: 1 })],
        ["pagina-marca:b", fila("b", { nivel: "marca", orden: 2 })],
      ]),
    );
    expect(await moverPaginaMarca("b", "arriba")).toEqual({ ok: true });
    const guardados = Object.fromEntries(m.guardar.mock.calls.map(([k, p]) => [k, p.orden]));
    expect(guardados).toEqual({ "pagina-marca:a": 2, "pagina-marca:b": 1 });
  });

  it("borrarPaginaMarca borra la fila", async () => {
    m.leer.mockResolvedValue(fila("acme"));
    expect(await borrarPaginaMarca("acme")).toEqual({ ok: true });
    expect(m.borrar).toHaveBeenCalledWith("pagina-marca:acme");
  });
});

describe("lecturas del editor", () => {
  it("valores de marca del catálogo, sin caché", async () => {
    m.valores.mockResolvedValue([{ valor: "ACME", count: 3 }]);
    expect(await valoresMarcaParaEditor()).toEqual({ ok: true, valores: [{ valor: "ACME", count: 3 }] });
    expect(m.valores).toHaveBeenCalledWith(true);
  });

  it("una página para editar, saneada", async () => {
    m.leer.mockResolvedValue(fila("acme"));
    const r = await leerPaginaMarcaParaEditar("acme");
    expect(r.ok && r.pagina.slug).toBe("acme");
  });
});

describe("guardarEncabezadoMarca (nombre, bajada y logo junto con el bloque hero)", () => {
  it("guarda todo en una sola escritura, sin tocar el resto", async () => {
    m.leer.mockResolvedValue(fila("acme", { bloques: { componentes: { titulo: "C", chips: ["A"] } } }));
    const r = await guardarEncabezadoMarca("acme", {
      nombre: "Acme SA",
      bajada: "Fábrica de luces",
      logo: "/images/marcas/acme.webp",
      hero: { sello: "Tienda oficial", cta: "Ver" },
    });
    expect(r).toEqual({ ok: true });
    expect(m.guardar).toHaveBeenCalledTimes(1);
    const [clave, payload] = m.guardar.mock.calls[0];
    expect(clave).toBe("pagina-marca:acme");
    expect(payload).toMatchObject({ slug: "acme", nombre: "Acme SA", bajada: "Fábrica de luces", logo: "/images/marcas/acme.webp" });
    expect(payload.bloques.hero).toEqual({ sello: "Tienda oficial", cta: "Ver" });
    expect(payload.bloques.componentes).toEqual({ titulo: "C", chips: ["A"] });
  });

  it("valida el nombre y no escribe si falta", async () => {
    m.leer.mockResolvedValue(fila("acme"));
    const r = await guardarEncabezadoMarca("acme", { nombre: " ", bajada: "", hero: {} });
    expect(r.ok).toBe(false);
    expect(m.guardar).not.toHaveBeenCalled();
  });

  it("sin admin no escribe", async () => {
    m.esAdmin.mockResolvedValue(false);
    expect(await guardarEncabezadoMarca("acme", { nombre: "X", bajada: "", hero: {} })).toEqual({ ok: false, errores: [SIN_PERMISO] });
  });
});

describe("guardarOrdenMarca", () => {
  it("guarda una permutación de los bloques del nivel", async () => {
    m.leer.mockResolvedValue(fila("acme", { nivel: "marca" }));
    expect(await guardarOrdenMarca("acme", ["productos", "hero", "lineas"])).toEqual({ ok: true });
    expect(m.guardar.mock.calls[0][1].bloquesOrden).toEqual(["productos", "hero", "lineas"]);
    expect(m.updateTag).toHaveBeenCalledWith("home");
  });

  it("rechaza bloques de otro nivel o un orden incompleto", async () => {
    m.leer.mockResolvedValue(fila("acme", { nivel: "marca" }));
    expect((await guardarOrdenMarca("acme", ["productos", "obras", "hero"])).ok).toBe(false);
    expect((await guardarOrdenMarca("acme", ["hero"])).ok).toBe(false);
    expect(m.guardar).not.toHaveBeenCalled();
  });
});
