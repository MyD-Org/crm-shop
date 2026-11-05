import { describe, expect, it } from "vitest";
import { mapFilaToProduct, videosDeFicha } from "./catalog";

/** Videos de YouTube del overlay en la ficha: ids → embed + poster, tope y descarte de inválidos. */

const fila = {
  alegraId: "7",
  name: "Lámpara",
  code: "LAM-1",
  description: null,
  brand: "Philips",
  prices: [{ idPriceList: "1", name: "General", price: 100000, main: true }],
  stock: "10",
  ivaPorcentaje: "21.00",
  categoryName: "Iluminación",
  overlayNombre: null,
  overlayFotos: null,
};

describe("videosDeFicha", () => {
  it("compone embed sin cookies y poster por cada id válido", () => {
    expect(videosDeFicha([{ id: "dQw4w9WgXcQ" }])).toEqual({
      videos: [
        {
          id: "dQw4w9WgXcQ",
          embed: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
          poster: "https://i.ytimg.com/vi/dQw4w9WgXcQ/oar2.jpg",
          posterRespaldo: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        },
      ],
    });
  });

  it("descarta ids inválidos y repetidos", () => {
    const r = videosDeFicha([
      { id: "malo" },
      { id: "dQw4w9WgXcQ" },
      { id: "dQw4w9WgXcQ" },
      { id: "https://x.example/a" },
    ]);
    expect(r.videos?.map((v) => v.id)).toEqual(["dQw4w9WgXcQ"]);
  });

  it("corta en 3", () => {
    const ids = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"].map((id) => ({ id }));
    expect(videosDeFicha(ids).videos?.map((v) => v.id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
  });

  it.each([null, undefined, [], [{ id: "malo" }]])("sin videos válidos no agrega la clave (%j)", (v) => {
    expect(videosDeFicha(v)).toEqual({});
  });
});

describe("mapFilaToProduct con videos", () => {
  it("expone videos en el producto", () => {
    const p = mapFilaToProduct({
      ...fila,
      overlayVideos: [{ id: "dQw4w9WgXcQ" }],
    });
    expect(p.videos).toHaveLength(1);
    expect(p.videos?.[0].id).toBe("dQw4w9WgXcQ");
  });

  it("sin overlayVideos el producto queda sin la clave", () => {
    expect("videos" in mapFilaToProduct(fila)).toBe(false);
    expect("videos" in mapFilaToProduct({ ...fila, overlayVideos: [] })).toBe(false);
  });
});
