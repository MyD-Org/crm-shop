import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";
import { FUENTE_MAIL, pieTexto, tarjetaMail, urlSitioMail } from "./mail-layout";

describe("tarjetaMail", () => {
  const base = {
    preheader: "Preheader de prueba",
    nombreComercio: "Tienda Ejemplo",
    cuerpoHtml: `<tr><td>Cuerpo</td></tr>`,
  };

  it("documento completo: charset, color-scheme, viewport y <title>", () => {
    const html = tarjetaMail(base);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light">');
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain("<title>Tienda Ejemplo</title>");
  });

  it("preheader oculto y escapado", () => {
    const html = tarjetaMail({ ...base, preheader: '<script>alert("x")</script>' });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("sin logo: nombre del comercio en texto; con logo: <img> con alt y ancho fluido", () => {
    const sinLogo = tarjetaMail(base);
    expect(sinLogo).not.toContain("<img");
    expect(sinLogo).toContain("Tienda Ejemplo");

    const conLogo = tarjetaMail({ ...base, logoUrl: "https://tienda.cliente.example/logo.png" });
    expect(conLogo).toContain('<img src="https://tienda.cliente.example/logo.png"');
    expect(conLogo).toContain('alt="Tienda Ejemplo"');
  });

  it("cuerpoHtml se inserta tal cual, sin volver a escaparlo", () => {
    const html = tarjetaMail({ ...base, cuerpoHtml: `<tr><td>${"<b>ya escapado</b>"}</td></tr>` });
    expect(html).toContain("<b>ya escapado</b>");
  });

  it("pie común: comercio, link al sitio si está, y el aviso de mensaje automático", () => {
    const conSitio = tarjetaMail({ ...base, sitioUrl: "https://tienda.cliente.example" });
    expect(conSitio).toContain('href="https://tienda.cliente.example"');
    expect(conSitio).toContain("tienda.cliente.example");
    expect(conSitio).toContain("Tienda Ejemplo");
    expect(conSitio).toContain("Este es un mensaje automático.");

    const sinSitio = tarjetaMail(base);
    expect(sinSitio).not.toContain("<a href");
    expect(sinSitio).toContain("Este es un mensaje automático.");
  });

  it("líneas propias del pie, escapadas y antes del pie común", () => {
    const html = tarjetaMail({ ...base, pie: ["<b>Aviso propio</b>"] });
    expect(html).toContain("&lt;b&gt;Aviso propio&lt;/b&gt;");
    expect(html.indexOf("Aviso propio")).toBeLessThan(html.indexOf("Este es un mensaje automático."));
  });

  it("usa FUENTE_MAIL y respeta un color de franja/fondo propio", () => {
    const html = tarjetaMail({ ...base, colorFranja: "#123456", colorFondo: "#eef1f5" });
    expect(html).toContain("#123456");
    expect(html).toContain("#eef1f5");
    expect(FUENTE_MAIL).toContain("system-ui");
  });

  it("en usted: sin voseo ni tuteo en ninguna parte fija del layout", () => {
    const html = tarjetaMail({ ...base, pie: ["Aviso propio"], sitioUrl: "https://tienda.cliente.example" });
    expect(infracciones(html, REGISTRO)).toEqual([]);
  });
});

describe("pieTexto", () => {
  it("comercio + link al sitio si está, y el aviso de mensaje automático", () => {
    expect(pieTexto("Tienda Ejemplo", "https://tienda.cliente.example")).toEqual([
      "Tienda Ejemplo · https://tienda.cliente.example",
      "Este es un mensaje automático.",
    ]);
    expect(pieTexto("Tienda Ejemplo", null)).toEqual(["Tienda Ejemplo", "Este es un mensaje automático."]);
  });

  it("antepone las líneas propias del mail", () => {
    expect(pieTexto("Tienda Ejemplo", null, ["Aviso propio"])).toEqual([
      "Aviso propio",
      "Tienda Ejemplo",
      "Este es un mensaje automático.",
    ]);
  });
});

describe("urlSitioMail", () => {
  it("arma la URL absoluta a la raíz, sin barra final, o null sin sitio o con uno inválido", () => {
    expect(urlSitioMail("https://tienda.cliente.example")).toBe("https://tienda.cliente.example");
    expect(urlSitioMail("https://tienda.cliente.example/")).toBe("https://tienda.cliente.example");
    expect(urlSitioMail("")).toBeNull();
    expect(urlSitioMail("no es una url")).toBeNull();
  });
});
