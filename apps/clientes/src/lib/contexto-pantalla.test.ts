import { describe, expect, it } from "vitest";
import { leerEstado } from "./catalogo-url";
import { MAX_PRIMEROS, TOPE_CONTEXTO, contextoPantalla, paginaDe } from "./contexto-pantalla";

const productos = [
  { id: "1101", name: "REFLECTOR LED 50W CALIDO IP65 CARCASA NEGRA ALUMINIO INYECTADO" },
  { id: "1102", name: "REFLECTOR LED 100W CALIDO IP66" },
  { id: "1103", name: "REFLECTOR LED 30W CALIDO CON SENSOR DE MOVIMIENTO Y FOTOCELULA" },
  { id: "1104", name: "REFLECTOR LED 20W CALIDO" },
  { id: "1105", name: "REFLECTOR LED 200W CALIDO ALTA POTENCIA PARA CANCHAS" },
  { id: "1106", name: "REFLECTOR LED 10W CALIDO" },
];

describe("paginaDe", () => {
  it.each([
    ["/", "inicio"],
    ["/catalogo", "catalogo"],
    ["/catalogo/", "catalogo"],
    ["/producto/1101", "producto"],
    ["/carrito", "carrito"],
    ["/mi-cuenta/pedidos", "otra"],
  ])("%s → %s", (ruta, pagina) => {
    expect(paginaDe(ruta)).toBe(pagina);
  });
});

describe("contextoPantalla (contrato contexto-pantalla-shop/v1)", () => {
  it("catálogo interpretado: url sin '?', total, hasta 5 productos, filtros con nombre e interpretado", () => {
    const estado = leerEstado({
      q: "50w",
      categoria: "REFLECTORES",
      marca: "GENROD",
      atr: ["tono-calido", "apto-exterior"],
      ia: "reflector calido para el patio 50w",
    });
    const c = contextoPantalla({ pathname: "/catalogo", catalogo: { estado, total: 37, productos } });
    expect(c.v).toBe(1);
    expect(c.pagina).toBe("catalogo");
    expect(c.catalogo!.url).toBe(
      "q=50w&categoria=REFLECTORES&marca=GENROD&atr=tono-calido&atr=apto-exterior&ia=reflector+calido+para+el+patio+50w",
    );
    expect(c.catalogo!.total).toBe(37);
    expect(c.catalogo!.filtros).toEqual([
      { tipo: "categoria", id: "REFLECTORES", nombre: "Reflectores" },
      { tipo: "marca", id: "GENROD", nombre: "Genrod" },
      { tipo: "atributo", id: "tono-calido", nombre: "Luz cálida" },
      { tipo: "atributo", id: "apto-exterior", nombre: "Apto exterior" },
    ]);
    expect(c.catalogo!.interpretado).toBe("reflector calido para el patio 50w");
    expect(c.catalogo!.primeros.length).toBeGreaterThan(0);
    expect(c.catalogo!.primeros.length).toBeLessThanOrEqual(MAX_PRIMEROS);
    // Los ids viajan enteros (ai-api los toma como ids conocidos del turno).
    expect(c.catalogo!.primeros.map((p) => p.id)).toEqual(productos.slice(0, c.catalogo!.primeros.length).map((p) => p.id));
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(TOPE_CONTEXTO);
  });

  it("respeta el tope aun con nombres larguísimos y muchos filtros", () => {
    const largos = productos.map((p) => ({ ...p, name: p.name.repeat(5) }));
    const estado = leerEstado({ marca: Array.from({ length: 30 }, (_, i) => `MARCA-${i}-CON-NOMBRE-LARGO`) });
    const c = contextoPantalla({ pathname: "/catalogo", catalogo: { estado, total: 999, productos: largos } });
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(TOPE_CONTEXTO);
  });

  it("sin datos personales ni precios: sólo las claves del contrato", () => {
    const c = contextoPantalla({ pathname: "/catalogo", catalogo: { estado: leerEstado({}), total: 2, productos: productos.slice(0, 2) } });
    expect(Object.keys(c).sort()).toEqual(["catalogo", "pagina", "v"]);
    expect(Object.keys(c.catalogo!).sort()).toEqual(["filtros", "primeros", "total", "url"]);
    expect(c.catalogo!.url).toBe("");
  });

  it("ficha: id, nombre y código (si difiere del nombre)", () => {
    expect(contextoPantalla({ pathname: "/producto/1101", producto: { id: "1101", name: "Reflector 50W", sku: "RF-50" } })).toEqual({
      v: 1,
      pagina: "producto",
      producto: { id: "1101", nombre: "Reflector 50W", codigo: "RF-50" },
    });
    expect(contextoPantalla({ pathname: "/producto/1", producto: { id: "1", name: "RF-50", sku: "RF-50" } }).producto).toEqual({ id: "1", nombre: "RF-50" });
  });

  it("carrito: sólo la cantidad de líneas; otras páginas, sólo la página", () => {
    expect(contextoPantalla({ pathname: "/carrito", carrito: { lineas: 3 } })).toEqual({ v: 1, pagina: "carrito", carrito: { lineas: 3 } });
    expect(contextoPantalla({ pathname: "/mi-cuenta" })).toEqual({ v: 1, pagina: "otra" });
    // Datos de otra página no se cuelan.
    expect(contextoPantalla({ pathname: "/", carrito: { lineas: 3 } })).toEqual({ v: 1, pagina: "inicio" });
  });
});
