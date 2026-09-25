import { describe, expect, it } from "vitest";
import {
  DEFAULTS_FOOTER,
  MAX_FOOTER,
  hrefMapsDireccion,
  hrefWhatsapp,
  linkLocal,
  nuevoLocal,
  normalizarHrefFooter,
  normalizarWhatsapp,
  resolverDatosFooter,
  textoBarra,
  validarDatosFooter,
} from "./footer";

const valido = (extra: Record<string, unknown> = {}) => ({ ...DEFAULTS_FOOTER, ...extra });

describe("defaults del footer", () => {
  it("los defaults validan y quedan idénticos (nada cambia sin fila)", () => {
    expect(validarDatosFooter(DEFAULTS_FOOTER)).toEqual({ ok: true, datos: DEFAULTS_FOOTER });
  });

  it("la barra izquierda usa el año automático", () => {
    expect(textoBarra(DEFAULTS_FOOTER.barraIzquierda, 2031)).toBe("© 2031 Central Led — Puerto Iguazú, Misiones");
  });
});

describe("textoBarra", () => {
  it("reemplaza todas las apariciones de {anio}; vacío → undefined", () => {
    expect(textoBarra("{anio} y {anio}", 2030)).toBe("2030 y 2030");
    expect(textoBarra("Sin año", 2030)).toBe("Sin año");
    expect(textoBarra("  ", 2030)).toBeUndefined();
  });
});

describe("normalizarWhatsapp", () => {
  it("deja solo dígitos", () => {
    expect(normalizarWhatsapp("+54 9 11 1234-5678")).toBe("5491112345678");
    expect(hrefWhatsapp("5491112345678")).toBe("https://wa.me/5491112345678");
  });
  it("rechaza letras, URLs y largos fuera de rango", () => {
    expect(normalizarWhatsapp("https://wa.me/5491112345678")).toBeNull();
    expect(normalizarWhatsapp("11 abc")).toBeNull();
    expect(normalizarWhatsapp("1234")).toBeNull();
    expect(normalizarWhatsapp("1234567890123456")).toBeNull();
  });
});

describe("normalizarHrefFooter", () => {
  it("acepta https (http se sube) y rutas internas", () => {
    expect(normalizarHrefFooter("https://cliente.example/x")).toBe("https://cliente.example/x");
    expect(normalizarHrefFooter("http://cliente.example/x")).toBe("https://cliente.example/x");
    expect(normalizarHrefFooter("/catalogo?cat=ILUMINACION")).toBe("/catalogo?cat=ILUMINACION");
  });
  it("rechaza esquemas peligrosos, protocol-relative y credenciales", () => {
    expect(normalizarHrefFooter("javascript:alert(1)")).toBeNull();
    expect(normalizarHrefFooter("//cliente.example")).toBeNull();
    expect(normalizarHrefFooter("/\\cliente.example")).toBeNull();
    expect(normalizarHrefFooter("mailto:hola@cliente.example")).toBeNull();
    expect(normalizarHrefFooter("https://usuario:clave@cliente.example")).toBeNull();
    expect(normalizarHrefFooter("catalogo")).toBeNull();
  });
});

describe("validarDatosFooter", () => {
  it("payload que no es objeto", () => {
    expect(validarDatosFooter(null)).toEqual({ ok: false, errores: ["Los datos enviados no son válidos."] });
    expect(validarDatosFooter([])).toEqual({ ok: false, errores: ["Los datos enviados no son válidos."] });
  });

  it("normaliza WhatsApp, ubicación y enlaces; descarta filas vacías", () => {
    const r = validarDatosFooter(
      valido({
        descripcion: "  Texto  ",
        whatsapp: "+54 9 11 1234-5678",
        locales: [
          { nombre: " Local centro ", direccion: " Calle Falsa 123 ", mapsUrl: "http://maps.cliente.example/?q=1", horario: "" },
          nuevoLocal(),
        ],
        enlaces: [
          { label: " Instagram ", href: "https://red.cliente.example/tienda" },
          { label: "", href: "" },
          { label: "Preguntas", href: "/preguntas" },
        ],
        barraIzquierda: " © {anio} Comercio ",
        barraDerecha: "",
      }),
    );
    expect(r).toEqual({
      ok: true,
      datos: {
        descripcion: "Texto",
        whatsapp: "5491112345678",
        locales: [{ nombre: "Local centro", direccion: "Calle Falsa 123", mapsUrl: "https://maps.cliente.example/?q=1", horario: "" }],
        enlaces: [
          { label: "Instagram", href: "https://red.cliente.example/tienda" },
          { label: "Preguntas", href: "/preguntas" },
        ],
        barraIzquierda: "© {anio} Comercio",
        barraDerecha: "",
      },
    });
  });

  it("WhatsApp vacío y sin locales se aceptan (no se muestran)", () => {
    const r = validarDatosFooter(valido({ whatsapp: "", locales: [] }));
    expect(r.ok && r.datos.whatsapp === "" && r.datos.locales.length === 0).toBe(true);
  });

  it("errores en usted, por campo", () => {
    const r = validarDatosFooter({
      descripcion: "",
      whatsapp: "abc",
      locales: [{ nombre: "Local", direccion: "", mapsUrl: "" }, { direccion: "Calle 1", mapsUrl: "javascript:alert(1)" }],
      enlaces: [{ label: "", href: "/x" }, { label: "Sitio", href: "ftp://cliente.example" }],
      barraIzquierda: "x".repeat(MAX_FOOTER.barra + 1),
      barraDerecha: "",
    });
    expect(r).toEqual({
      ok: false,
      errores: [
        "Ingrese la descripción del pie de página.",
        "Indique un número de WhatsApp válido, con código de país (por ejemplo, 54 9 11 1234 5678).",
        "Indique la dirección del local 1.",
        "Indique un enlace de mapa válido para el local 2 (https://…).",
        "Indique el texto del enlace 1.",
        "Indique una dirección válida para el enlace 2 (https://… o una ruta que empiece con /).",
        `El texto izquierdo de la barra inferior supera los ${MAX_FOOTER.barra} caracteres.`,
      ],
    });
  });

  it("tope de enlaces y largos", () => {
    const enlaces = Array.from({ length: MAX_FOOTER.enlaces + 1 }, (_, i) => ({ label: `E${i}`, href: "/x" }));
    const r = validarDatosFooter(valido({ enlaces, descripcion: "d".repeat(MAX_FOOTER.descripcion + 1) }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores).toContain(`Puede agregar hasta ${MAX_FOOTER.enlaces} enlaces.`);
      expect(r.errores).toContain(`La descripción supera los ${MAX_FOOTER.descripcion} caracteres.`);
    }
  });
});

describe("resolverDatosFooter", () => {
  it("sin fila o basura → defaults", () => {
    expect(resolverDatosFooter(undefined)).toEqual(DEFAULTS_FOOTER);
    expect(resolverDatosFooter(42)).toEqual(DEFAULTS_FOOTER);
    expect(resolverDatosFooter({ descripcion: "", whatsapp: "abc" })).toEqual(DEFAULTS_FOOTER);
  });

  it("campos que faltan se heredan del default", () => {
    expect(resolverDatosFooter({ descripcion: "Otra" })).toEqual({ ...DEFAULTS_FOOTER, descripcion: "Otra" });
  });
});


describe("locales", () => {
  const LOCAL = { nombre: "", direccion: "Calle Falsa 123", mapsUrl: "", horario: "" };

  it("default: un local sin dirección → link \"Ubicación\" al mismo mapa de siempre", () => {
    expect(DEFAULTS_FOOTER.locales).toHaveLength(1);
    expect(linkLocal(DEFAULTS_FOOTER.locales[0])).toEqual({
      label: "Ubicación",
      href: DEFAULTS_FOOTER.locales[0].mapsUrl,
    });
  });

  it("dirección sin enlace: arma la búsqueda de Google Maps", () => {
    expect(hrefMapsDireccion("Calle Falsa 123, Ciudad Ejemplo")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Calle%20Falsa%20123%2C%20Ciudad%20Ejemplo",
    );
    expect(linkLocal(LOCAL)).toEqual({
      label: "Calle Falsa 123",
      href: "https://www.google.com/maps/search/?api=1&query=Calle%20Falsa%20123",
    });
  });

  it("texto con nombre, dirección y horario; el enlace cargado manda", () => {
    expect(
      linkLocal({ nombre: "Local centro", direccion: "Calle Falsa 123", mapsUrl: "https://maps.cliente.example/a", horario: "Lun a Sáb" }),
    ).toEqual({ label: "Local centro: Calle Falsa 123 · Lun a Sáb", href: "https://maps.cliente.example/a" });
    expect(linkLocal({ ...nuevoLocal(), nombre: "Depósito", mapsUrl: "https://maps.cliente.example/b" })?.label).toBe("Depósito");
  });

  it("sin dirección ni enlace: no hay link", () => {
    expect(linkLocal(nuevoLocal())).toBeNull();
  });

  it("valida 0, 1 y 2 locales", () => {
    const cero = validarDatosFooter(valido({ locales: [] }));
    expect(cero.ok && cero.datos.locales).toEqual([]);
    const uno = validarDatosFooter(valido({ locales: [LOCAL] }));
    expect(uno.ok && uno.datos.locales).toEqual([LOCAL]);
    const dos = validarDatosFooter(
      valido({ locales: [LOCAL, { nombre: "Local 2", direccion: "Calle Ejemplo 456", mapsUrl: "", horario: "Lun a Vie" }] }),
    );
    expect(dos.ok && dos.datos.locales.map((l) => l.nombre)).toEqual(["", "Local 2"]);
  });

  it("tope de locales y largos", () => {
    const muchos = Array.from({ length: MAX_FOOTER.locales + 1 }, () => LOCAL);
    const r = validarDatosFooter(valido({ locales: muchos }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores).toContain(`Puede cargar hasta ${MAX_FOOTER.locales} locales.`);
    const largo = validarDatosFooter(valido({ locales: [{ ...LOCAL, direccion: "d".repeat(MAX_FOOTER.direccion + 1) }] }));
    expect(largo).toEqual({ ok: false, errores: [`La dirección del local 1 supera los ${MAX_FOOTER.direccion} caracteres.`] });
  });

  it("locales que no son lista → error", () => {
    expect(validarDatosFooter(valido({ locales: "Calle Falsa 123" }))).toEqual({
      ok: false,
      errores: ["Los datos enviados no son válidos."],
    });
  });
});
