import { describe, expect, it } from "vitest";
import {
  MARCAS,
  chunksDeRuta,
  formatearMarcas,
  formatearTabla,
  leerManifiestoRsc,
  rutaDesdeClave,
} from "./medir-js";

describe("rutaDesdeClave", () => {
  it("convierte la clave del manifiesto en la URL de la ruta", () => {
    expect(rutaDesdeClave("/page")).toBe("/");
    expect(rutaDesdeClave("/catalogo/page")).toBe("/catalogo");
    expect(rutaDesdeClave("/producto/[id]/page")).toBe("/producto/[id]");
  });

  it("ignora los grupos de rutas", () => {
    expect(rutaDesdeClave("/(tienda)/carrito/page")).toBe("/carrito");
  });

  it("descarta rutas internas de Next y slots paralelos", () => {
    expect(rutaDesdeClave("/_not-found/page")).toBeNull();
    expect(rutaDesdeClave("/_global-error/page")).toBeNull();
    expect(rutaDesdeClave("/mi-cuenta/@migas/[...ruta]/page")).toBeNull();
  });
});

describe("chunksDeRuta", () => {
  it("suma los chunks raíz y los de cada segmento, sin duplicados", () => {
    const chunks = chunksDeRuta(
      {
        entryJSFiles: {
          "[project]/src/app/layout": ["static/chunks/b.js", "static/chunks/c.js"],
          "[project]/src/app/catalogo/page": [
            "static/chunks/b.js",
            "static/chunks/d.js",
            "static/chunks/estilos.css",
          ],
        },
      },
      { rootMainFiles: ["static/chunks/a.js", "static/chunks/b.js"] },
    );
    expect(chunks).toEqual([
      "static/chunks/a.js",
      "static/chunks/b.js",
      "static/chunks/c.js",
      "static/chunks/d.js",
    ]);
  });

  it("tolera manifiestos sin entradas", () => {
    expect(chunksDeRuta({}, {})).toEqual([]);
  });
});

describe("leerManifiestoRsc", () => {
  it("evalúa el manifiesto sin tocar el global del proceso", () => {
    const codigo = [
      "globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};",
      'globalThis.__RSC_MANIFEST["/catalogo/page"] = {"entryJSFiles":{"x":["static/chunks/a.js"]}};',
    ].join("\n");
    expect(leerManifiestoRsc(codigo)).toEqual({
      "/catalogo/page": { entryJSFiles: { x: ["static/chunks/a.js"] } },
    });
    expect("__RSC_MANIFEST" in globalThis).toBe(false);
  });
});

describe("formatearTabla", () => {
  it("ordena de mayor a menor y muestra KB con un decimal", () => {
    const tabla = formatearTabla([
      { ruta: "/carrito", chunks: [], bytesGz: 1024 },
      { ruta: "/", chunks: [], bytesGz: 2048 + 512 },
    ]);
    expect(tabla).toBe(
      ["| ruta | KB gz |", "| --- | ---: |", "| `/` | 2.5 |", "| `/carrito` | 1.0 |"].join(
        "\n",
      ),
    );
  });
});

describe("marcas", () => {
  it("reconocen las clases que dejan recharts y react-day-picker", () => {
    expect(MARCAS.recharts.test('className:"recharts-wrapper"')).toBe(true);
    expect(MARCAS["react-day-picker"].test('"rdp-root"')).toBe(true);
    expect(MARCAS["react-day-picker"].test('"cardp-x"')).toBe(false);
  });

  it("listan las rutas o avisan que no hay ninguna", () => {
    expect(
      formatearMarcas({ recharts: [], "react-day-picker": ["/mi-cuenta/pagos", "/mi-cuenta"] }),
    ).toBe(
      "- `recharts`: ninguna ruta\n- `react-day-picker`: `/mi-cuenta`, `/mi-cuenta/pagos`",
    );
  });
});
