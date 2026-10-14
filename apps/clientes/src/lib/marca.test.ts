import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/marca-contrato.json";
import {
  MARCA_POR_DEFECTO,
  altLogo,
  idTecnico,
  descripcionPedido,
  hostsDeMarca,
  marcaDeEntorno,
  nombreMarcaEntorno,
  partesNombre,
  resolverMarca,
  sanearMarca,
} from "./marca-base";

/** El fixture compartido con el admin usa {"$repetir":[c,n]} para las cadenas largas. */
function expandir(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(expandir);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.$repetir)) return String(o.$repetir[0]).repeat(Number(o.$repetir[1]));
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, expandir(x)]));
  }
  return v;
}

const hosts = (fixture.contexto.hosts as string[]).map((h) => h.toLowerCase());

describe("sanearMarca (fixture marca-contrato.json, mismo contrato que el admin)", () => {
  for (const caso of fixture.validos) {
    it(`válido: ${caso.nombre}`, () => {
      expect(sanearMarca(expandir(caso.entrada), hosts)).toEqual(expandir(caso.salida));
    });
  }

  // El Shop es tolerante: lo inválido se descarta y el resto se conserva; nunca lanza.
  for (const caso of fixture.invalidos) {
    it(`inválido (se descarta, no lanza): ${caso.nombre}`, () => {
      const entrada = expandir(caso.entrada);
      const salida = sanearMarca(entrada, hosts) as Record<string, unknown>;
      if (caso.campo === "marca") {
        expect(salida).toEqual({});
      } else {
        expect(salida[caso.campo], caso.campo).toBeUndefined();
      }
    });
  }

  it("sin hosts permitidos ninguna imagen pasa", () => {
    expect(sanearMarca({ logoUrl: "https://media.example/l.svg" }, [])).toEqual({});
  });
});

describe("resolverMarca", () => {
  it("{} es exactamente MARCA_POR_DEFECTO (Central)", () => {
    expect(resolverMarca({}, undefined, hosts)).toEqual(MARCA_POR_DEFECTO);
    expect(resolverMarca(null)).toEqual(MARCA_POR_DEFECTO);
    expect(resolverMarca("basura")).toEqual(MARCA_POR_DEFECTO);
  });

  it("la marca de Central ignora la variable de entorno del nombre", () => {
    expect(resolverMarca({}, "Otra Tienda")).toEqual(MARCA_POR_DEFECTO);
  });

  it("los textos de Central son los de siempre", () => {
    expect(MARCA_POR_DEFECTO.nombre).toBe("Central LED");
    expect(MARCA_POR_DEFECTO.titulo).toBe("Central LED — Tienda Online");
    expect(MARCA_POR_DEFECTO.descripcion).toBe(
      "Iluminación, materiales eléctricos, herramientas y mucho más en Puerto Iguazú, Misiones. Stock en tiempo real.",
    );
    expect(MARCA_POR_DEFECTO.descripcionManifest).toBe(
      "Iluminación, materiales eléctricos, herramientas y mucho más en Puerto Iguazú, Misiones.",
    );
  });

  it("la imagen para compartir de Central dice lo de siempre", () => {
    expect(MARCA_POR_DEFECTO.ogTextos).toEqual({
      eyebrow: "ILUMINACIÓN · ELECTRICIDAD",
      bajada: "Iluminación, materiales eléctricos y mucho más",
      lugar: "Tienda online · Puerto Iguazú, Misiones",
    });
    expect(MARCA_POR_DEFECTO.lema).toBe("Iluminación · Electricidad");
  });

  it("base central con nombre propio deriva el título", () => {
    const m = resolverMarca({ nombre: "Otra" });
    expect(m.nombre).toBe("Otra");
    expect(m.titulo).toBe("Otra — Tienda Online");
    expect(m.descripcion).toBe(MARCA_POR_DEFECTO.descripcion);
  });

  it("genérica: nada de Central", () => {
    const m = resolverMarca({ base: "generica", nombre: "Tienda Uno", descripcion: "Descripción propia" });
    expect(m.base).toBe("generica");
    expect(m.titulo).toBe("Tienda Uno — Tienda Online");
    expect(m.lema).toBe("");
    expect(m.ogTextos).toEqual({ eyebrow: "", bajada: "", lugar: "" });
    expect(JSON.stringify(m)).not.toMatch(/central|iguaz/i);
  });

  it("genérica sin nombre toma la variable de entorno y, si no, un nombre neutro", () => {
    expect(resolverMarca({ base: "generica" }, "Tienda Dos").nombre).toBe("Tienda Dos");
    expect(resolverMarca({ base: "generica" }).nombre).toBe("Tienda online");
  });

  it("URLs fuera de los hosts permitidos se descartan", () => {
    const m = resolverMarca({ base: "generica", nombre: "T", logoUrl: "https://otro.example/l.svg" }, undefined, hosts);
    expect(m.logoUrl).toBeUndefined();
    const ok = resolverMarca({ base: "generica", nombre: "T", logoUrl: "https://media.example/l.svg" }, undefined, hosts);
    expect(ok.logoUrl).toBe("https://media.example/l.svg");
  });
});

describe("marcaDeEntorno (la base no responde)", () => {
  it("con la variable: sólo el nombre, sin logo ni textos de Central", () => {
    const m = marcaDeEntorno("Tienda Uno");
    expect(m.nombre).toBe("Tienda Uno");
    expect(m.logoUrl).toBeUndefined();
    expect(JSON.stringify(m)).not.toMatch(/central|iguaz/i);
  });
  it("sin la variable: la de Central", () => {
    expect(marcaDeEntorno(undefined)).toEqual(MARCA_POR_DEFECTO);
    expect(marcaDeEntorno("  ")).toEqual(MARCA_POR_DEFECTO);
  });
  it("nombreMarcaEntorno: variable o 'Central LED'", () => {
    expect(nombreMarcaEntorno("Tienda Uno")).toBe("Tienda Uno");
    expect(nombreMarcaEntorno(undefined)).toBe("Central LED");
  });
});

describe("ayudas de presentación", () => {
  it("partesNombre: Central en dos tintas, el resto entero", () => {
    expect(partesNombre(MARCA_POR_DEFECTO)).toEqual({ principal: "Central", acento: "Led" });
    expect(partesNombre({ nombre: "Tienda Uno" })).toEqual({ principal: "Tienda Uno" });
  });
  it("altLogo", () => {
    expect(altLogo(MARCA_POR_DEFECTO)).toBe("Central Led");
    expect(altLogo({ nombre: "Tienda Uno" })).toBe("Tienda Uno");
  });
  it("idTecnico: Central 'CentralLed'; otra marca, su nombre sin símbolos", () => {
    expect(idTecnico(MARCA_POR_DEFECTO)).toBe("CentralLed");
    expect(idTecnico({ nombre: "Tienda Úno & Cía" })).toBe("TiendaUnoCia");
    expect(idTecnico({ nombre: "&&" })).toBe("Shop");
  });
  it("descripcionPedido: Central = el texto de siempre; otra marca sin 'Central LED'", () => {
    expect(descripcionPedido("000123", MARCA_POR_DEFECTO)).toBe("Pedido 000123 — Central LED");
    const otra = descripcionPedido("000123", { nombre: "Tienda Uno" });
    expect(otra).toBe("Pedido 000123 — Tienda Uno");
    expect(otra).not.toMatch(/central/i);
  });
  it("hostsDeMarca une SHOP_MEDIA_HOSTS y el host del bucket", () => {
    expect(
      hostsDeMarca({ SHOP_MEDIA_HOSTS: "A.example, b.example", R2_SHOP_MEDIA_PUBLIC_URL: "https://c.example/x" }),
    ).toEqual(["a.example", "b.example", "c.example"]);
    expect(hostsDeMarca({})).toEqual([]);
  });
});
