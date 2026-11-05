import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoFacade } from "./VideoFacade";

const video = {
  id: "dQw4w9WgXcQ",
  embed: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  poster: "https://i.ytimg.com/vi/dQw4w9WgXcQ/oar2.jpg",
  posterRespaldo: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
};

describe("VideoFacade", () => {
  it("sin reproducir: poster y botón, sin iframe", () => {
    const html = renderToStaticMarkup(
      <VideoFacade video={video} reproduciendo={false} onReproducir={() => {}} titulo="Lámpara" />,
    );
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("youtube-nocookie");
    expect(html).toContain(video.poster);
    expect(html).toContain('aria-label="Reproducir video"');
    expect(html).toContain("<button");
    expect(html).toContain('loading="lazy"');
  });

  it("reproduciendo: iframe sin cookies con autoplay, playsinline y rel=0", () => {
    const html = renderToStaticMarkup(
      <VideoFacade video={video} reproduciendo onReproducir={() => {}} titulo="Lámpara" />,
    );
    expect(html).toContain("<iframe");
    expect(html).toContain(`${video.embed}?autoplay=1&amp;rel=0&amp;playsinline=1`);
    expect(html).toContain('title="Video de Lámpara"');
    // El poster queda debajo (da la proporción de la caja); el botón de play ya no está.
    expect(html).toContain(video.poster);
    expect(html).not.toContain('aria-label="Reproducir video"');
  });

  it("la caja entra entera en el slide con la proporción del poster (16:9 hasta que carga)", () => {
    const html = renderToStaticMarkup(
      <VideoFacade video={video} reproduciendo={false} onReproducir={() => {}} titulo="Lámpara" />,
    );
    expect(html).toContain("container-type:size");
    expect(html).toContain("min(100cqw, calc(100cqh * 1.7777777777777777))");
  });
});
