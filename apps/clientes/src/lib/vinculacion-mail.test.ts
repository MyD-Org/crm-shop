import { describe, expect, it } from "vitest";
import { armarMailCodigoVinculacion, urlLogoMail } from "./vinculacion-mail";

const mail = armarMailCodigoVinculacion({ codigo: "123456", vigenciaMin: 10, tienda: "Tienda Ejemplo" });

describe("armarMailCodigoVinculacion", () => {
  it("asunto y texto plano llevan el código entero (autocompletado del celular)", () => {
    expect(mail.subject).toBe("123456 es su código para vincular su cuenta");
    expect(mail.text).toContain("es 123456.");
    expect(mail.text).toContain("Vence en 10 minutos.");
  });

  it("el HTML muestra el código agrupado y el preheader con el vencimiento", () => {
    expect(mail.html).toContain("123 456");
    expect(mail.html).toContain("Su código es 123456. Vence en 10 minutos.");
    expect(mail.html).toContain("Tienda Ejemplo");
  });

  it("todo en usted: sin voseo ni tuteo", () => {
    for (const parte of [mail.subject, mail.html, mail.text]) {
      expect(parte).not.toMatch(/\b(tu|tus|te|vos)\b|pediste|ignorá|usá|vinculá/i);
    }
    expect(mail.html).toContain("Vincule su cuenta");
    expect(mail.html).toContain("cuenta de cliente");
  });

  it("escapa el nombre de la tienda", () => {
    const m = armarMailCodigoVinculacion({ codigo: "123456", vigenciaMin: 10, tienda: "<b>X</b>" });
    expect(m.html).not.toContain("<b>X</b>");
  });

  it("con logo: imagen con el nombre de la tienda como alt; sin logo, el nombre en texto", () => {
    const conLogo = armarMailCodigoVinculacion({
      codigo: "123456",
      vigenciaMin: 10,
      tienda: "Tienda Ejemplo",
      logoUrl: "https://tienda.cliente.example/images/central-led/logo-mail.png",
    });
    expect(conLogo.html).toContain('<img src="https://tienda.cliente.example/images/central-led/logo-mail.png"');
    expect(conLogo.html).toContain('alt="Tienda Ejemplo"');
    expect(mail.html).not.toContain("<img");
  });
});

describe("urlLogoMail", () => {
  it("arma la URL absoluta desde el sitio, o null sin sitio o con uno inválido", () => {
    expect(urlLogoMail("https://tienda.cliente.example")).toBe(
      "https://tienda.cliente.example/images/central-led/logo-mail.png",
    );
    expect(urlLogoMail("")).toBeNull();
    expect(urlLogoMail("no es una url")).toBeNull();
  });
});
