import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";
import { armarMailAviso, enlacesBaja } from "./aviso-reingreso-mail";

const mail = armarMailAviso({
  nombreProducto: "Lámpara <Ejemplo> Blanco cálido",
  urlProducto: "https://tienda.example/producto/mdp%3A12",
  sitioUrl: "https://tienda.example",
  tokenBaja: "tok-abc_123",
  comercio: "Tienda Ejemplo",
  logoUrl: null,
});

describe("armarMailAviso", () => {
  it("asunto con el producto y link a la ficha de la variante en html y texto", () => {
    expect(mail.subject).toBe("Ya hay disponible: Lámpara <Ejemplo> Blanco cálido");
    for (const parte of [mail.html, mail.text]) expect(parte).toContain("https://tienda.example/producto/mdp%3A12");
  });

  it("dice 'sujeto a stock', no promete reserva y escapa el nombre en el html", () => {
    for (const parte of [mail.html, mail.text]) {
      expect(parte).toContain("sujeta a stock");
      expect(parte).not.toMatch(/reserv/i);
    }
    expect(mail.html).toContain("Lámpara &lt;Ejemplo&gt; Blanco cálido");
    expect(mail.html).not.toContain("<Ejemplo>");
  });

  it("lleva el enlace de baja en el cuerpo y las cabeceras List-Unsubscribe (one-click)", () => {
    const { pagina, unClic } = enlacesBaja("https://tienda.example", "tok-abc_123");
    expect(pagina).toBe("https://tienda.example/baja-aviso/tok-abc_123");
    expect(unClic).toBe("https://tienda.example/api/aviso-reingreso/baja?token=tok-abc_123");
    for (const parte of [mail.html, mail.text]) expect(parte).toContain(pagina);
    expect(mail.headers["List-Unsubscribe"]).toBe(`<${unClic}>, <${pagina}>`);
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("codifica el token en los enlaces", () => {
    expect(enlacesBaja("https://tienda.example", "a/b c").pagina).toBe("https://tienda.example/baja-aviso/a%2Fb%20c");
  });

  it("está en usted, sin voseo ni dominios reales", () => {
    for (const parte of [mail.text, mail.subject]) expect(infracciones(parte, REGISTRO)).toEqual([]);
    expect(mail.text).toContain("Recibe este mensaje porque pidió");
    expect(mail.html).not.toMatch(/https?:\/\/(?![a-z0-9.-]*\.example)/);
  });
});
