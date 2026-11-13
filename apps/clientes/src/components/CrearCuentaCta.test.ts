import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { REGISTRO, infracciones } from "@/test/registro-usted";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
}));
vi.mock("@myd-org/ui", () => ({ Button: ({ children }: { children: unknown }) => createElement("button", null, children as never) }));

import { CrearCuentaCta } from "./CrearCuentaCta";
import { TEXTOS_CREAR_CUENTA, TEXTOS_PAGAR } from "@/lib/pagar-textos";

describe("CrearCuentaCta", () => {
  it("lleva a /registro con el email precargado y avisa que se asocian los pedidos", () => {
    const html = renderToStaticMarkup(createElement(CrearCuentaCta, { email: "ana@cliente.example" }));
    expect(html).toContain('href="/registro?email=ana%40cliente.example"');
    expect(html).toContain("Cree su cuenta");
    expect(html).toContain("se asociarán a su cuenta");
  });

  it("sin email va a /registro a secas", () => {
    expect(renderToStaticMarkup(createElement(CrearCuentaCta, {}))).toContain('href="/registro"');
  });

  it("no pide datos ni guarda nada en el navegador", () => {
    const fuente = readFileSync(new URL("./CrearCuentaCta.tsx", import.meta.url), "utf8");
    expect(fuente).not.toMatch(/<input|<form|document\.cookie|localStorage|sessionStorage/);
  });

  it("los textos van en usted", () => {
    const todo = JSON.stringify({ ...TEXTOS_CREAR_CUENTA, ...TEXTOS_PAGAR });
    expect(infracciones(todo, REGISTRO)).toEqual([]);
  });
});
