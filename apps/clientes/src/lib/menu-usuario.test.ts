import { describe, expect, it } from "vitest";
import {
  ENTRADAS_MENU,
  HREF_FAVORITOS,
  HREF_MIS_DATOS,
  HREF_MIS_PEDIDOS,
  entradasMenu,
  etiquetaBotonMenu,
  tabInicial,
} from "./menu-usuario";

describe("menu del usuario", () => {
  it("ofrece las cuatro entradas en orden, con Cerrar sesión al final", () => {
    expect(ENTRADAS_MENU.map((e) => e.id)).toEqual(["pedidos", "datos", "seguridad", "salir"]);
    expect(ENTRADAS_MENU.at(-1)).toMatchObject({ id: "salir", tone: "danger" });
  });

  it("Mis pedidos y Mis datos llevan a Mi cuenta, Mis datos a su pestaña", () => {
    expect(HREF_MIS_PEDIDOS).toBe("/mi-cuenta");
    expect(HREF_MIS_DATOS).toBe("/mi-cuenta?tab=datos");
    expect(tabInicial("datos")).toBe("datos");
  });

  it("los textos están en registro formal, sin voseo ni tuteo", () => {
    const textos = [...ENTRADAS_MENU.map((e) => e.label), etiquetaBotonMenu(null)].join(" ");
    expect(textos).not.toMatch(/\b(tu|tus|te|vos)\b/i);
  });

  it("el botón tiene etiqueta accesible con y sin nombre", () => {
    expect(etiquetaBotonMenu("María Romero")).toContain("María Romero");
    expect(etiquetaBotonMenu(null)).toBe("Menú de su cuenta");
  });
});

describe("Favoritos en el menú, detrás de la capacidad de despliegue", () => {
  it("apagada (hoy): el menú queda igual que antes", () => {
    expect(entradasMenu({ favoritos: false, facturas: false }).map((e) => e.id)).toEqual([
      "pedidos",
      "datos",
      "seguridad",
      "salir",
    ]);
    expect(ENTRADAS_MENU).toEqual(entradasMenu({ favoritos: false, facturas: false }));
  });

  it("encendida: Favoritos va entre Mis pedidos y Mis datos, como en la navegación", () => {
    const entradas = entradasMenu({ favoritos: true, facturas: true });
    expect(entradas.map((e) => e.id)).toEqual(["pedidos", "favoritos", "datos", "seguridad", "salir"]);
    expect(entradas.filter((e) => e.tone === "danger").map((e) => e.id)).toEqual(["salir"]);
    expect(entradas.find((e) => e.id === "favoritos")?.label).toBe("Favoritos");
  });

  it("Facturas nunca entra al menú del header", () => {
    expect(entradasMenu({ favoritos: true, facturas: true }).map((e) => e.id)).not.toContain("facturas");
  });

  it("Favoritos lleva a su sección; Mis pedidos sigue en el resumen", () => {
    expect(HREF_FAVORITOS).toBe("/mi-cuenta/favoritos");
    expect(HREF_MIS_PEDIDOS).toBe("/mi-cuenta");
  });
});

describe("tabInicial", () => {
  it("abre la pestaña pedida", () => {
    expect(tabInicial("datos")).toBe("datos");
  });

  it("toma el primero si viene repetido", () => {
    expect(tabInicial(["datos", "compras"])).toBe("datos");
  });

  it("cae en Mis pedidos si falta o no existe", () => {
    expect(tabInicial(undefined)).toBe("compras");
    expect(tabInicial(null)).toBe("compras");
    expect(tabInicial("")).toBe("compras");
    expect(tabInicial("otra")).toBe("compras");
    // Direcciones dejó de ser pestaña: ahora es una sección de Mis datos.
    expect(tabInicial("direcciones")).toBe("compras");
  });
});
