import { describe, expect, it } from "vitest";
import { armarItems, debeMontarIframe, etiquetaVisor, reproduccionInicial } from "./galeria-items";

const fotos = [
  { url: "https://medios.cliente.example/a.jpg", w: 800 },
  { url: "https://medios.cliente.example/b.jpg", w: 800, alt: "B" },
];
const videos = [
  {
    id: "dQw4w9WgXcQ",
    embed: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    poster: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
];

describe("armarItems", () => {
  it("pone los videos después de las fotos", () => {
    const items = armarItems(fotos, videos);
    expect(items.map((i) => i.tipo)).toEqual(["foto", "foto", "video"]);
  });
  it("sin videos o sin fotos", () => {
    expect(armarItems(fotos).map((i) => i.tipo)).toEqual(["foto", "foto"]);
    expect(armarItems(undefined, videos).map((i) => i.tipo)).toEqual(["video"]);
    expect(armarItems()).toEqual([]);
  });
});

describe("reproduccionInicial", () => {
  const items = armarItems(fotos, videos);
  it("sólo reproduce si se pidió y el slide inicial es video", () => {
    expect(reproduccionInicial(items, 2, true)).toBe("dQw4w9WgXcQ");
    expect(reproduccionInicial(items, 2, false)).toBeNull();
    expect(reproduccionInicial(items, 0, true)).toBeNull();
  });
});

describe("debeMontarIframe", () => {
  const items = armarItems(fotos, videos);
  it("sólo en el slide activo y con el video en reproducción", () => {
    expect(debeMontarIframe(items[2], 2, 2, "dQw4w9WgXcQ")).toBe(true);
    expect(debeMontarIframe(items[2], 2, 1, "dQw4w9WgXcQ")).toBe(false); // otro slide activo
    expect(debeMontarIframe(items[2], 2, 2, null)).toBe(false); // sin play
    expect(debeMontarIframe(items[0], 0, 0, "dQw4w9WgXcQ")).toBe(false); // foto
  });
});

describe("etiquetaVisor", () => {
  it("cuenta videos en el aria-label", () => {
    expect(etiquetaVisor(armarItems(fotos, videos), "Lámpara")).toBe("Fotos y videos de Lámpara");
    expect(etiquetaVisor(armarItems(fotos), "Lámpara")).toBe("Fotos de Lámpara");
  });
});
