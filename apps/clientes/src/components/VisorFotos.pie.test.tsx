import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./MarcaProvider", () => ({ useMarca: () => "Marca" }));

import { PieVisor } from "./VisorFotos";
import { armarItems } from "./galeria-items";

const foto = (n: number) => ({ url: `https://medios.cliente.example/${n}.jpg`, w: 800 });
const video = {
  id: "dQw4w9WgXcQ",
  embed: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  poster: "https://i.ytimg.com/vi/dQw4w9WgXcQ/oar2.jpg",
  posterRespaldo: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
};

describe("PieVisor", () => {
  it("el contador cuenta fotos y videos", () => {
    const items = armarItems([foto(1), foto(2)], [video]);
    expect(renderToStaticMarkup(<PieVisor items={items} activa={2} onIr={() => {}} />)).toContain("3 / 3");
  });

  it("con un video activo muestra Anterior (sin Siguiente si es el último), fuera del iframe", () => {
    const items = armarItems([foto(1), foto(2)], [video]);
    const html = renderToStaticMarkup(<PieVisor items={items} activa={2} onIr={() => {}} />);
    expect(html).toContain('aria-label="Foto anterior"');
    expect(html).not.toContain("siguiente");
  });

  it("en el medio de la lista, con un video activo, muestra las dos", () => {
    const items = armarItems([foto(1)], [video, { ...video, id: "aaaaaaaaaaa" }]);
    const html = renderToStaticMarkup(<PieVisor items={items} activa={1} onIr={() => {}} />);
    expect(html).toContain('aria-label="Foto anterior"');
    expect(html).toContain('aria-label="Video siguiente"');
  });

  it("con una foto activa no hay botones en el pie (las flechas son desde md, sobre la foto)", () => {
    const items = armarItems([foto(1), foto(2)], [video]);
    expect(renderToStaticMarkup(<PieVisor items={items} activa={0} onIr={() => {}} />)).not.toContain("<button");
  });

  it("sin más de un elemento no hay contador", () => {
    const items = armarItems(undefined, [video]);
    const html = renderToStaticMarkup(<PieVisor items={items} activa={0} onIr={() => {}} />);
    expect(html).not.toContain("/ 1");
    expect(html).not.toContain("<button");
  });
});
