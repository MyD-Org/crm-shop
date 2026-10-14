import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// El handler de Clerk no participa: el gate corta antes.
const { clerk } = vi.hoisted(() => ({ clerk: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: () => clerk }));

import { proxy } from "./proxy";

const evento = {} as never;
const pedir = (ruta = "/catalogo") => proxy(new NextRequest(`http://localhost${ruta}`), evento);

describe("gate de «Próximamente» — marca", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("Central (sin variable): la cortina de siempre", async () => {
    vi.stubEnv("SITE_AUTH_USER", "u");
    vi.stubEnv("SITE_AUTH_PASSWORD", "p");
    vi.stubEnv("NEXT_PUBLIC_SHOP_MARCA_NOMBRE", "");
    const html = await (await pedir()).text();
    expect(html).toContain("<title>Central LED — Próximamente</title>");
    expect(html).toContain('<div class="logo">Central LED</div>');
  });

  it("tienda con marca propia: su nombre, nada de Central y sin catálogo", async () => {
    vi.stubEnv("SITE_AUTH_USER", "u");
    vi.stubEnv("SITE_AUTH_PASSWORD", "p");
    vi.stubEnv("NEXT_PUBLIC_SHOP_MARCA_NOMBRE", "Tienda <Uno> & Cía");
    const res = await pedir();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Tienda &lt;Uno&gt; &amp; Cía — Próximamente</title>");
    expect(html).toContain('<div class="logo">Tienda &lt;Uno&gt; &amp; Cía</div>');
    expect(html).not.toMatch(/central/i);
    expect(clerk).not.toHaveBeenCalled();
  });
});
