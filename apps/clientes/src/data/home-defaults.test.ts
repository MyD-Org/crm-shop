import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULTS_HOME,
  SECCIONES_HOME,
  erroresSeccion,
  combinarContenidoHome,
  esHref,
  esImagen,
  aVisibleOn,
  difierePorTamano,
  itemsEn,
  migrarAcento,
  migrarVisibilidad,
  sinCamposOcultos,
  sinItemsOcultos,
  textoVisibleOn,
  sinMarcasDeAcento,
  motivoImagenInvalida,
  type HeroContent,
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

  it("tiles: velo acepta suave, fuerte o ausente", () => {
    const conVelo = (velo: unknown) =>
      erroresSeccion("decoGrid", {
        ...DEFAULTS_HOME.decoGrid,
        items: [{ ...DEFAULTS_HOME.decoGrid.items[0], velo }],
      });
    expect(conVelo("suave")).toEqual([]);
    expect(conVelo("fuerte")).toEqual([]);
    expect(conVelo(undefined)).toEqual([]);
    expect(conVelo("oscuro").length).toBeGreaterThan(0);
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

describe("títulos con acento en cualquier posición y versión mobile", () => {
  const sin = (o: object, ...campos: string[]) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !campos.includes(k)));

  it("eyebrow y bajada son opcionales en hero, bannerDeco y tiles", () => {
    expect(erroresSeccion("hero", sin(DEFAULTS_HOME.hero, "eyebrow", "bajada"))).toEqual([]);
    expect(erroresSeccion("bannerDeco", sin(DEFAULTS_HOME.bannerDeco, "eyebrow", "bajada"))).toEqual([]);
    const items = DEFAULTS_HOME.ambientes.items.map((t) => sin(t, "eyebrow"));
    expect(erroresSeccion("ambientes", { ...DEFAULTS_HOME.ambientes, items })).toEqual([]);
  });

  it("todos los textos son opcionales: basta con los datos que no son texto", () => {
    expect(erroresSeccion("anuncio", {})).toEqual([]);
    expect(erroresSeccion("hero", { imagen: "/images/hero.webp", ctas: [], usps: [] })).toEqual([]);
    expect(erroresSeccion("ambientes", { items: [{ imagen: "/images/a.webp", href: "/catalogo" }] })).toEqual([]);
    expect(erroresSeccion("destacados", { cantidad: 4 })).toEqual([]);
    expect(erroresSeccion("bannerDeco", { imagen: "/images/b.webp" })).toEqual([]);
    expect(erroresSeccion("decoGrid", { items: [], chips: [] })).toEqual([]);
    expect(erroresSeccion("servicios", { items: [{}] })).toEqual([]);
    expect(erroresSeccion("marquee", { items: [] })).toEqual([]);
    expect(erroresSeccion("whatsapp", { href: "/contacto" })).toEqual([]);
  });

  it("un texto vacío sin normalizar se rechaza (el editor lo omite antes de guardar)", () => {
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, titulo: "" })).toContain("titulo debe ser un texto no vacío");
  });

  it("imagen y destino de los enlaces siguen siendo obligatorios", () => {
    expect(erroresSeccion("bannerDeco", { imagen: "" }).length).toBeGreaterThan(0);
    expect(erroresSeccion("whatsapp", {}).length).toBeGreaterThan(0);
    expect(erroresSeccion("destacados", { linkTodos: "javascript:alert(1)", cantidad: 4 }).length).toBeGreaterThan(0);
  });

  it("acepta título y bajada de mobile, y los rechaza vacíos", () => {
    const hero = { ...DEFAULTS_HOME.hero, tituloMobile: "Todo para *su obra*", bajadaMobile: "Corta" };
    expect(erroresSeccion("hero", hero)).toEqual([]);
    expect(erroresSeccion("decoGrid", { ...DEFAULTS_HOME.decoGrid, tituloMobile: " " })).toContain(
      "tituloMobile debe ser un texto no vacío",
    );
  });

  it("sinMarcasDeAcento deja el texto plano", () => {
    expect(sinMarcasDeAcento("Los más *vendidos*")).toBe("Los más vendidos");
    expect(sinMarcasDeAcento("Precio *especial")).toBe("Precio *especial");
  });

  it("migrarAcento pasa el acento viejo al final del título con marcas", () => {
    expect(migrarAcento({ titulo: "Los más ", acento: "vendidos", linkTodos: "/" })).toEqual({
      titulo: "Los más *vendidos*",
      linkTodos: "/",
    });
    expect(migrarAcento({ titulo: "Sin acento", acento: "" })).toEqual({ titulo: "Sin acento" });
    const nuevo = { titulo: "Todo lo que *su proyecto* necesita" };
    expect(migrarAcento(nuevo)).toBe(nuevo);
  });

  it("combinarContenidoHome convierte las filas guardadas con el formato viejo", () => {
    const viejo = { ...DEFAULTS_HOME.bannerDeco, titulo: "Ambientá tus noches con", acento: "luz cálida" };
    const r = combinarContenidoHome([{ key: "bannerDeco", payload: viejo }]);
    expect(r.bannerDeco.titulo).toBe("Ambientá tus noches con *luz cálida*");
    expect("acento" in r.bannerDeco).toBe(false);
  });

  it("camposOcultos (formato viejo) sigue validando y se lee como visibilidadTextos en \"nunca\"", () => {
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, camposOcultos: ["eyebrow", "titulo"] })).toEqual([]);
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, camposOcultos: ["imagen"] }).length).toBeGreaterThan(0);
    const out = combinarContenidoHome([{ key: "hero", payload: { ...DEFAULTS_HOME.hero, camposOcultos: ["titulo"] } }]);
    expect(out.hero.camposOcultos).toBeUndefined();
    expect(out.hero.visibilidadTextos).toEqual({ titulo: "nunca" });
  });

  it("sinCamposOcultos saca los textos en \"nunca\" y su versión mobile; los de un solo tamaño quedan", () => {
    const hero: HeroContent = {
      ...DEFAULTS_HOME.hero,
      tituloMobile: "Corto",
      visibilidadTextos: { titulo: "nunca", bajada: "mobile" },
    };
    const visible = sinCamposOcultos(hero);
    expect(visible.titulo).toBeUndefined();
    expect(visible.tituloMobile).toBeUndefined();
    expect(visible.bajada).toBe(DEFAULTS_HOME.hero.bajada);
    expect(textoVisibleOn(visible, "bajada")).toBe("mobile");
    expect(textoVisibleOn(visible, "eyebrow")).toBeUndefined();
    expect(hero.titulo).toBe(DEFAULTS_HOME.hero.titulo); // no muta
  });

  it("visibilidadTextos: sólo campos conocidos y valores desktop/mobile/nunca", () => {
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, visibilidadTextos: { eyebrow: "desktop" } })).toEqual([]);
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, visibilidadTextos: { imagen: "nunca" } }).length).toBeGreaterThan(0);
    expect(erroresSeccion("hero", { ...DEFAULTS_HOME.hero, visibilidadTextos: { titulo: "siempre" } }).length).toBeGreaterThan(0);
    expect(erroresSeccion("whatsapp", { ...DEFAULTS_HOME.whatsapp, visibilidadTextos: { texto: "mobile" } })).toEqual([]);
    expect(erroresSeccion("whatsapp", { ...DEFAULTS_HOME.whatsapp, visibilidadTextos: { bajada: "mobile" } }).length).toBeGreaterThan(0);
  });
});

describe("visibilidad de ítems", () => {
  it("cada ítem de lista acepta visibilidad y rechaza valores desconocidos", () => {
    const hero = DEFAULTS_HOME.hero;
    expect(erroresSeccion("hero", { ...hero, ctas: [{ label: "A", href: "/a", visibilidad: "mobile" }] })).toEqual([]);
    expect(erroresSeccion("hero", { ...hero, usps: [{ label: "A", visibilidad: "desktop" }] })).toEqual([]);
    expect(erroresSeccion("hero", { ...hero, usps: [{ label: "A", visibilidad: "a veces" }] }).length).toBeGreaterThan(0);
    const tile = { ...DEFAULTS_HOME.ambientes.items[0], visibilidad: "nunca" };
    expect(erroresSeccion("ambientes", { ...DEFAULTS_HOME.ambientes, items: [tile] })).toEqual([]);
    expect(erroresSeccion("servicios", { items: [{ titulo: "A", visibilidad: "mobile" }] })).toEqual([]);
    expect(erroresSeccion("marquee", { items: [{ texto: "A", visibilidad: "desktop" }, "B"] })).toEqual([]);
    expect(erroresSeccion("marquee", { items: [{ texto: "" }] }).length).toBeGreaterThan(0);
  });

  it("la cinta guardada como textos sueltos se lee como { texto }", () => {
    const out = combinarContenidoHome([{ key: "marquee", payload: { items: ["Uno", "Dos"] } }]);
    expect(out.marquee.items).toEqual([{ texto: "Uno" }, { texto: "Dos" }]);
    expect(migrarVisibilidad(out.marquee)).toEqual(out.marquee); // idempotente
  });

  it("helpers: filtrar por tamaño y detectar si hace falta una versión por tamaño", () => {
    const items = [{ id: 1 }, { id: 2, visibilidad: "mobile" as const }, { id: 3, visibilidad: "nunca" as const }];
    expect(sinItemsOcultos(items).map((i) => i.id)).toEqual([1, 2]);
    expect(itemsEn(items, "mobile").map((i) => i.id)).toEqual([1, 2]);
    expect(itemsEn(items, "desktop").map((i) => i.id)).toEqual([1]);
    expect(difierePorTamano(items)).toBe(true);
    expect(difierePorTamano([{ id: 1 }, { id: 3, visibilidad: "nunca" as const }])).toBe(false);
    expect(aVisibleOn("nunca")).toBeUndefined();
    expect(aVisibleOn("desktop")).toBe("desktop");
  });
});
