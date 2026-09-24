import { describe, expect, it, vi } from "vitest";
import { cerrarSesion } from "./cerrar-sesion";

describe("cerrarSesion", () => {
  it("vacía el carrito, borra la cookie del portal y recién después cierra Clerk", async () => {
    const orden: string[] = [];
    await cerrarSesion({
      vaciarCarrito: () => orden.push("carrito"),
      fetchImpl: (async (url: string, init?: RequestInit) => {
        orden.push(`${init?.method} ${url}`);
        return new Response(null, { status: 204 });
      }) as typeof fetch,
      signOut: async () => orden.push("clerk"),
    });
    expect(orden).toEqual(["carrito", "POST /api/sesion/cerrar", "clerk"]);
  });

  it("si no se puede borrar la cookie, cierra la sesión de Clerk igual", async () => {
    const signOut = vi.fn(async () => {});
    await cerrarSesion({
      vaciarCarrito: () => {},
      fetchImpl: (async () => {
        throw new TypeError("sin red");
      }) as typeof fetch,
      signOut,
    });
    expect(signOut).toHaveBeenCalledOnce();
  });
});
