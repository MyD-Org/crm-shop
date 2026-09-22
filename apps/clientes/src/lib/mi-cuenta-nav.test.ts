import { describe, expect, it } from "vitest";
import {
  CAPACIDADES_DESPLIEGUE,
  bajadaMiCuenta,
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
  it("Clerk vinculado con todo desplegado: 7 entradas: Direcciones y envíos van juntas", () => {
    const s = seccionesVisibles({ clerk: true, vinculado: true }, TODO);
    expect(ids(s)).toEqual([
      "pedidos",
      "facturas",
      "favoritos",
      "direcciones",
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

  it("cookie del CRM sin Clerk: sólo Pedidos, Facturas y Direcciones y envíos", () => {
    const s = seccionesVisibles({ clerk: false, vinculado: true }, TODO);
    expect(ids(s)).toEqual(["pedidos", "facturas", "direcciones"]);
  });

  it("Clerk sin vínculo también ve Facturas (la página ofrece vincular)", () => {
    expect(ids(seccionesVisibles({ clerk: true, vinculado: false }, TODO))).toContain("facturas");
  });

  it("C desplegada sin D ni E: 5 entradas para Clerk", () => {
    const s = seccionesVisibles({ clerk: true, vinculado: true }, NADA);
    expect(ids(s)).toEqual(["pedidos", "direcciones", "datos", "seguridad", "salir"]);
  });

  it("la función es total: sin identidad quedan las secciones públicas", () => {
    expect(ids(seccionesVisibles({ clerk: false, vinculado: false }, TODO))).toEqual([
      "pedidos",
      "facturas",
      "direcciones",
    ]);
  });

  it("por default usa el despliegue actual, que ya publica favoritos", () => {
    expect(CAPACIDADES_DESPLIEGUE.favoritos).toBe(true);
    expect(seccionesVisibles({ clerk: true, vinculado: true })).toEqual(
      seccionesVisibles({ clerk: true, vinculado: true }, CAPACIDADES_DESPLIEGUE),
    );
    expect(seccionesVisibles({ clerk: true, vinculado: false }).map((x) => x.id)).toContain(
      "favoritos",
    );
    // La cookie del CRM sin Clerk no tiene dónde guardarlos.
    expect(seccionesVisibles({ clerk: false, vinculado: true }).map((x) => x.id)).not.toContain(
      "favoritos",
    );
  });

  it("labels del copy aprobado", () => {
    expect(seccionesVisibles({ clerk: true, vinculado: true }, TODO).map((x) => x.label)).toEqual([
      "Pedidos",
      "Facturas",
      "Favoritos",
      "Direcciones y envíos",
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
    expect(migasMiCuenta("/mi-cuenta/direcciones")).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Mi cuenta", href: "/mi-cuenta" },
      { label: "Direcciones y envíos" },
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

describe("bajadaMiCuenta", () => {
  it("sin facturas desplegadas no las promete", () => {
    const texto = bajadaMiCuenta({ favoritos: false, facturas: false });
    expect(texto).toBe("Revise el estado de sus pedidos y repita compras con un clic.");
    expect(texto).not.toMatch(/factura/i);
  });

  it("con facturas desplegadas las menciona", () => {
    expect(bajadaMiCuenta({ favoritos: false, facturas: true })).toBe(
      "Revise el estado de sus pedidos, descargue facturas y repita compras con un clic.",
    );
  });

  it("por defecto usa lo desplegado hoy", () => {
    expect(bajadaMiCuenta()).toBe(bajadaMiCuenta(CAPACIDADES_DESPLIEGUE));
  });
});
