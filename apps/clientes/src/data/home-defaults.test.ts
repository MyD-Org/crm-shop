import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULTS_HOME,
  SECCIONES_HOME,
  erroresSeccion,
  combinarContenidoHome,
  esHref,
  esImagen,
  motivoImagenInvalida,
} from "./home-defaults";

const HOSTS = ["media.plataforma.example"];

describe("defaults de home", () => {
  it("todas las secciones default validan sin errores", () => {
    for (const key of SECCIONES_HOME) {
      if (key === "navBadge") continue; // null = sin badge
      expect(erroresSeccion(key, DEFAULTS_HOME[key as keyof typeof DEFAULTS_HOME])).toEqual([]);
    }
  });

  it("navBadge default trae el tag Nuevo de Iluminación (diseño aprobado)", () => {
    expect(DEFAULTS_HOME.navBadge).toEqual({
      categoria: "ILUMINACION",
      texto: "Nuevo",
    });
  });
});

describe("erroresSeccion", () => {
  it("rechaza sección desconocida", () => {
    expect(erroresSeccion("zzz", {}).length).toBeGreaterThan(0);
  });

  it("hero exige titulo e imagen", () => {
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, titulo: 42 }).length).toBeGreaterThan(0);
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, imagen: "" }).length).toBeGreaterThan(0);
  });

  it("destacados valida cantidad entre 1 y 24", () => {
    expect(erroresSeccion("destacados", { ...DEFAULTS_HOME.destacados, cantidad: 0 }).length).toBeGreaterThan(0);
    expect(erroresSeccion("destacados", { ...DEFAULTS_HOME.destacados, cantidad: 99 }).length).toBeGreaterThan(0);
  });

  it("navBadge acepta null (borrar badge)", () => {
    expect(erroresSeccion("navBadge", null)).toEqual([]);
  });

  it("enlaces exigen label y href", () => {
    expect(
      erroresSeccion("decoGrid", {
        ...DEFAULTS_HOME.decoGrid,
        chips: [{ label: "x" }],
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe("combinarContenidoHome", () => {
  it("con filas vacías devuelve los defaults", () => {
    expect(combinarContenidoHome([])).toEqual(DEFAULTS_HOME);
  });

  it("una fila válida pisa solo su sección", () => {
    const hero = { ...DEFAULTS_HOME.hero, titulo: "Otro título" };
    const out = combinarContenidoHome([{ key: "hero", payload: hero }]);
    expect(out.hero.titulo).toBe("Otro título");
    expect(out.anuncio).toEqual(DEFAULTS_HOME.anuncio);
  });

  it("un payload inválido se ignora y queda el default", () => {
    const out = combinarContenidoHome([{ key: "hero", payload: { roto: true } }]);
    expect(out.hero).toEqual(DEFAULTS_HOME.hero);
  });

  it("una key desconocida se ignora", () => {
    const out = combinarContenidoHome([{ key: "zzz", payload: {} }]);
    expect(out).toEqual(DEFAULTS_HOME);
  });

  it("navBadge null se conserva como null", () => {
    const out = combinarContenidoHome([
      { key: "navBadge", payload: { categoria: "Decorativa", texto: "Nuevo" } },
    ]);
    expect(out.navBadge).toEqual({ categoria: "Decorativa", texto: "Nuevo" });
  });
});

describe("sección whatsapp (home-editable B1)", () => {
  it("SECCIONES_HOME contiene whatsapp", () => {
    expect(SECCIONES_HOME).toContain("whatsapp");
  });

  it("el default valida sin errores", () => {
    expect(erroresSeccion("whatsapp", DEFAULTS_HOME.whatsapp)).toEqual([]);
  });

  it("exige titulo y texto no vacíos", () => {
    const errores = erroresSeccion("whatsapp", { titulo: "", texto: "x", href: "/contacto" });
    expect(errores.length).toBeGreaterThan(0);
    expect(errores.some((e) => e.includes("titulo"))).toBe(true);
  });

  it("rechaza un href inválido", () => {
    const errores = erroresSeccion("whatsapp", { titulo: "a", texto: "b", href: "javascript:alert(1)" });
    expect(errores.length).toBeGreaterThan(0);
    expect(errores.some((e) => e.includes("href"))).toBe(true);
  });

  it("combinarContenidoHome: una fila válida reemplaza el CTA", () => {
    const out = combinarContenidoHome([
      { key: "whatsapp", payload: { titulo: "Consúltenos", texto: "t", href: "https://wa.me/5491100000000" } },
    ]);
    expect(out.whatsapp.titulo).toBe("Consúltenos");
  });

  it("combinarContenidoHome: una fila inválida deja el default", () => {
    const out = combinarContenidoHome([{ key: "whatsapp", payload: { titulo: "" } }]);
    expect(out.whatsapp).toEqual(DEFAULTS_HOME.whatsapp);
  });
});

describe("esHref", () => {
  it("acepta rutas internas y URLs https", () => {
    for (const v of ["/", "/catalogo?categorias=ILUMINACION", "https://wa.me/5491100000000", "https://cliente.example/p"]) {
      expect(esHref(v), v).toBe(true);
    }
  });

  it("rechaza vacíos, http, javascript:, protocol-relative, mailto, rutas sin / y tipos no string", () => {
    for (const v of ["", "   ", "http://cliente.example", "javascript:alert(1)", "//cliente.example", "mailto:a@cliente.example", "catalogo", 42, null]) {
      expect(esHref(v), String(v)).toBe(false);
    }
  });

  it("se aplica a hero.ctas, decoGrid.chips, bannerDeco.cta, ambientes.items[].href y los linkTodos", () => {
    expect(
      erroresSeccion("hero", { ...DEFAULTS_HOME.hero, ctas: [{ label: "Ir", href: "http://x.example" }] }).some((e) =>
        e.includes("ctas"),
      ),
    ).toBe(true);
    expect(
      erroresSeccion("decoGrid", { ...DEFAULTS_HOME.decoGrid, chips: [{ label: "x", href: "http://x.example" }] }).some(
        (e) => e.includes("chips"),
      ),
    ).toBe(true);
    expect(
      erroresSeccion("bannerDeco", { ...DEFAULTS_HOME.bannerDeco, cta: { label: "x", href: "http://x.example" } }).some(
        (e) => e.includes("cta"),
      ),
    ).toBe(true);
    expect(
      erroresSeccion("ambientes", {
        ...DEFAULTS_HOME.ambientes,
        items: [{ ...DEFAULTS_HOME.ambientes.items[0], href: "http://x.example" }],
      }).some((e) => e.includes("items")),
    ).toBe(true);
    expect(
      erroresSeccion("ambientes", { ...DEFAULTS_HOME.ambientes, linkTodos: "http://x.example" }).some((e) =>
        e.includes("linkTodos"),
      ),
    ).toBe(true);
    expect(
      erroresSeccion("destacados", { ...DEFAULTS_HOME.destacados, linkTodos: "http://x.example" }).some((e) =>
        e.includes("linkTodos"),
      ),
    ).toBe(true);
  });

  it("los defaults siguen válidos tras endurecer esHref", () => {
    for (const key of SECCIONES_HOME) {
      if (key === "navBadge") continue;
      expect(erroresSeccion(key, DEFAULTS_HOME[key as keyof typeof DEFAULTS_HOME])).toEqual([]);
    }
  });
});

describe("compatibilidad de filas guardadas antes de skus/imagenes", () => {
  it("destacados viejo hereda skus/imagenes del default (no apaga lo curado)", () => {
    const viejo = { ...DEFAULTS_HOME.destacados } as Record<string, unknown>;
    delete viejo.skus;
    delete viejo.imagenes;
    const out = combinarContenidoHome([{ key: "destacados", payload: viejo }]);
    expect(out.destacados.skus).toEqual(DEFAULTS_HOME.destacados.skus);
    expect(out.destacados.imagenes).toEqual(DEFAULTS_HOME.destacados.imagenes);
  });

  it("destacados con skus propios los usa (no hereda los del default)", () => {
    const out = combinarContenidoHome([
      { key: "destacados", payload: { ...DEFAULTS_HOME.destacados, skus: ["OTRO-SKU"] } },
    ]);
    expect(out.destacados.skus).toEqual(["OTRO-SKU"]);
  });

  it("destacados rechaza imagenes externas (next/image no las sirve sin remotePatterns)", () => {
    expect(
      erroresSeccion("destacados", {
        ...DEFAULTS_HOME.destacados,
        imagenes: ["https://cdn.externa.com/foto.webp"],
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe("esImagen / motivoImagenInvalida (home-editable C)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Path local", () => {
    expect(esImagen("/images/hero.webp", [])).toBe(true);
  });

  it("https de host habilitado", () => {
    expect(esImagen("https://media.plataforma.example/home/t/abc-1600.webp", HOSTS)).toBe(true);
  });

  it("Rechazos", () => {
    for (const v of [
      "http://media.plataforma.example/x.webp",
      "https://otro.example/x.webp",
      "javascript:x",
      "//media.plataforma.example/x",
      "",
      "images/x.webp",
    ]) {
      expect(esImagen(v, HOSTS), v).toBe(false);
    }
  });

  it("motivoImagenInvalida distingue host de formato", () => {
    expect(motivoImagenInvalida("https://otro.example/x.webp", HOSTS)).toBe("host");
    expect(motivoImagenInvalida("images/x", HOSTS)).toBe("formato");
    expect(motivoImagenInvalida("/images/x.webp", HOSTS)).toBeNull();
    expect(motivoImagenInvalida("https://media.plataforma.example/x.webp", HOSTS)).toBeNull();
  });

  it("erroresSeccion(hero) con imagen https de host habilitado ⇒ []", () => {
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, imagen: "https://media.plataforma.example/x.webp" }, HOSTS)).toEqual([]);
  });

  it("erroresSeccion(hero) con hosts vacíos ⇒ error de host", () => {
    const errores = erroresSeccion("hero", { ...DEFAULTS_HOME.hero, imagen: "https://media.plataforma.example/x.webp" }, []);
    expect(errores).toContain("imagen: el host de la imagen no está habilitado (SHOP_MEDIA_HOSTS).");
  });

  it("erroresSeccion(hero) con formato inválido ⇒ error de formato", () => {
    const errores = erroresSeccion("hero", { ...DEFAULTS_HOME.hero, imagen: "images/x" }, HOSTS);
    expect(errores).toContain("imagen debe ser una ruta local (/images/...) o una URL https de un host habilitado.");
  });

  it("destacados.imagenes acepta https de host habilitado", () => {
    expect(
      erroresSeccion(
        "destacados",
        { ...DEFAULTS_HOME.destacados, imagenes: ["https://media.plataforma.example/home/t/a-1600.webp"] },
        HOSTS,
      ),
    ).toEqual([]);
  });

  it("destacados.imagenes con hosts vacíos ⇒ error que menciona SHOP_MEDIA_HOSTS", () => {
    const errores = erroresSeccion(
      "destacados",
      { ...DEFAULTS_HOME.destacados, imagenes: ["https://media.plataforma.example/home/t/a-1600.webp"] },
      [],
    );
    expect(errores.some((e) => e.includes("SHOP_MEDIA_HOSTS"))).toBe(true);
  });

  it("tiles (ambientes) aceptan https de host habilitado", () => {
    expect(
      erroresSeccion(
        "ambientes",
        { ...DEFAULTS_HOME.ambientes, items: [{ ...DEFAULTS_HOME.ambientes.items[0], imagen: "https://media.plataforma.example/x.webp" }] },
        HOSTS,
      ),
    ).toEqual([]);
  });

  it("bannerDeco.imagen acepta https de host habilitado", () => {
    expect(
      erroresSeccion("bannerDeco", { ...DEFAULTS_HOME.bannerDeco, imagen: "https://media.plataforma.example/x.webp" }, HOSTS),
    ).toEqual([]);
  });

  it("Default de hosts: usa SHOP_MEDIA_HOSTS cuando no se pasa el tercer argumento", () => {
    vi.stubEnv("SHOP_MEDIA_HOSTS", "media.plataforma.example");
    expect(
      erroresSeccion("hero", { ...DEFAULTS_HOME.hero, imagen: "https://media.plataforma.example/h.webp" }),
    ).toEqual([]);
  });
});
