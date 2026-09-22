import { describe, expect, it } from "vitest";
import {
  CAPACIDADES_DESPLIEGUE,
  RUTAS_MI_CUENTA,
  capacidadesDe,
  hrefPedido,
  migasMiCuenta,
  seccionActiva,
  seccionesVisibles,
} from "./mi-cuenta-nav";

const TODO = { favoritos: true, facturas: true };
const NADA = { favoritos: false, facturas: false };
const ids = (s: { id: string }[]) => s.map((x) => x.id);

/** Navegación de Mi cuenta: secciones por identidad y despliegue (NAV-2, NAV-3). */
describe("seccionesVisibles", () => {
  it("Clerk vinculado con todo desplegado: 8 entradas en el orden del mockup", () => {
    const s = seccionesVisibles({ clerk: true, vinculado: true }, TODO);
    expect(ids(s)).toEqual([
      "pedidos",
      "facturas",
      "favoritos",
      "direcciones",
      "envios",
      "datos",
      "seguridad",
      "salir",
    ]);
    expect(s.filter((x) => x.tone === "danger").map((x) => x.id)).toEqual(["salir"]);
    // Seguridad y Cerrar sesión son acciones, no rutas.
    expect(s.find((x) => x.id === "seguridad")?.href).toBeUndefined();
    expect(s.find((x) => x.id === "salir")?.href).toBeUndefined();
    expect(s.find((x) => x.id === "pedidos")?.href).toBe(RUTAS_MI_CUENTA.pedidos);
    expect(s.find((x) => x.id === "datos")?.href).toBe(RUTAS_MI_CUENTA.datos);
  });

  it("cookie del CRM sin Clerk: sólo Pedidos, Facturas y Envíos y retiro", () => {
    const s = seccionesVisibles({ clerk: false, vinculado: true }, TODO);
    expect(ids(s)).toEqual(["pedidos", "facturas", "envios"]);
  });

  it("Clerk sin vínculo también ve Facturas (la página ofrece vincular)", () => {
    expect(ids(seccionesVisibles({ clerk: true, vinculado: false }, TODO))).toContain("facturas");
  });

  it("C desplegada sin D ni E: 6 entradas para Clerk", () => {
    const s = seccionesVisibles({ clerk: true, vinculado: true }, NADA);
    expect(ids(s)).toEqual(["pedidos", "direcciones", "envios", "datos", "seguridad", "salir"]);
  });

  it("la función es total: sin identidad quedan las secciones públicas", () => {
    expect(ids(seccionesVisibles({ clerk: false, vinculado: false }, TODO))).toEqual([
      "pedidos",
      "facturas",
      "envios",
    ]);
  });

  it("por default usa el despliegue actual, que todavía no publica favoritos ni facturas", () => {
    expect(CAPACIDADES_DESPLIEGUE).toEqual({ favoritos: false, facturas: false });
    expect(seccionesVisibles({ clerk: true, vinculado: true })).toEqual(
      seccionesVisibles({ clerk: true, vinculado: true }, NADA),
    );
  });

  it("labels del copy aprobado", () => {
    expect(seccionesVisibles({ clerk: true, vinculado: true }, TODO).map((x) => x.label)).toEqual([
      "Pedidos",
      "Facturas",
      "Favoritos",
      "Direcciones",
      "Envíos y retiro",
      "Mis datos",
      "Seguridad",
      "Cerrar sesión",
    ]);
  });
});

describe("capacidadesDe", () => {
  it("Clerk y vínculo según la identidad", () => {
    expect(capacidadesDe({ clerkUserId: "user_1", cliente: { codigocliente: "C-1" } })).toEqual({
      clerk: true,
      vinculado: true,
    });
    expect(capacidadesDe({ clerkUserId: "user_1", cliente: null })).toEqual({
      clerk: true,
      vinculado: false,
    });
    expect(capacidadesDe({ clerkUserId: null, cliente: { codigocliente: "C-1" } })).toEqual({
      clerk: false,
      vinculado: true,
    });
    expect(capacidadesDe({ clerkUserId: null, cliente: null })).toEqual({
      clerk: false,
      vinculado: false,
    });
  });
});

describe("seccionActiva", () => {
  it.each([
    ["/mi-cuenta", "pedidos"],
    ["/mi-cuenta/", "pedidos"],
    ["/mi-cuenta/pedidos", "pedidos"],
    ["/mi-cuenta/pedidos/9f1c", "pedidos"],
    ["/mi-cuenta/facturas?pagina=2", "facturas"],
    ["/mi-cuenta/favoritos", "favoritos"],
    ["/mi-cuenta/direcciones", "direcciones"],
    ["/mi-cuenta/envios", "envios"],
    ["/mi-cuenta/datos", "datos"],
    ["/mi-cuenta/vincular", "datos"],
    ["/mi-cuenta/lo-que-sea", "pedidos"],
  ])("%s → %s", (pathname, esperado) => {
    expect(seccionActiva(pathname)).toBe(esperado);
  });
});

describe("migasMiCuenta", () => {
  it("resumen: Inicio / Mi cuenta, el último sin enlace", () => {
    expect(migasMiCuenta("/mi-cuenta")).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Mi cuenta" },
    ]);
  });

  it("una sección: Inicio / Mi cuenta / sección", () => {
    expect(migasMiCuenta("/mi-cuenta/favoritos")).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Mi cuenta", href: "/mi-cuenta" },
      { label: "Favoritos" },
    ]);
    expect(migasMiCuenta("/mi-cuenta/envios")).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Mi cuenta", href: "/mi-cuenta" },
      { label: "Envíos y retiro" },
    ]);
  });

  it("detalle de pedido: Pedidos queda como enlace (el número lo agrega quien tiene el pedido)", () => {
    expect(migasMiCuenta("/mi-cuenta/pedidos/x")).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Mi cuenta", href: "/mi-cuenta" },
      { label: "Pedidos", href: "/mi-cuenta/pedidos" },
    ]);
  });

  it("la lista de pedidos: Pedidos es el último, sin enlace", () => {
    expect(migasMiCuenta("/mi-cuenta/pedidos").at(-1)).toEqual({ label: "Pedidos" });
  });

  it("vincular cuelga de Mis datos", () => {
    expect(migasMiCuenta("/mi-cuenta/vincular")).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Mi cuenta", href: "/mi-cuenta" },
      { label: "Mis datos", href: "/mi-cuenta/datos" },
      { label: "Vincule su cuenta de cliente" },
    ]);
  });

  it("ignora query y barra final", () => {
    expect(migasMiCuenta("/mi-cuenta/facturas/?pagina=3")).toEqual(migasMiCuenta("/mi-cuenta/facturas"));
  });
});

describe("rutas", () => {
  it("hrefPedido cuelga de la lista de pedidos", () => {
    expect(hrefPedido("9f1c")).toBe("/mi-cuenta/pedidos/9f1c");
  });

  it("todas las rutas viven bajo /mi-cuenta", () => {
    for (const ruta of Object.values(RUTAS_MI_CUENTA)) expect(ruta).toMatch(/^\/mi-cuenta(\/|$)/);
  });
});

describe("registro", () => {
  it("ningún texto con tuteo ni voseo", () => {
    const rutas = [
      "/mi-cuenta",
      ...Object.values(RUTAS_MI_CUENTA),
      "/mi-cuenta/pedidos/x",
    ];
    const textos = [
      ...seccionesVisibles({ clerk: true, vinculado: true }, TODO).map((x) => x.label),
      ...rutas.flatMap((r) => migasMiCuenta(r).map((m) => m.label)),
    ].join(" ");
    expect(textos).not.toMatch(/\b(tu|tus|te|vos)\b/i);
  });
});
