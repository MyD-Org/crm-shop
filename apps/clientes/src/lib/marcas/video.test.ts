import { describe, expect, it } from "vitest";
import { videoEmbebible, videoYoutubePorId } from "./video";

describe("videoYoutubePorId", () => {
  it("compone el embed sin cookies y el poster de un id válido", () => {
    expect(videoYoutubePorId("dQw4w9WgXcQ")).toEqual({
      id: "dQw4w9WgXcQ",
      embed: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      poster: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
  });

  it.each(["", "corto", "dQw4w9WgXcQ1", "dQw4w9WgX/Q", "dQw4w9Wg Xc", "javascript:1;;", null, undefined, 12345678901])(
    "descarta %j",
    (id) => {
      expect(videoYoutubePorId(id)).toBeNull();
    },
  );
});

describe("videoEmbebible (sin cambios)", () => {
  it("sigue aceptando YouTube y Vimeo y rechazando lo demás", () => {
    expect(videoEmbebible("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({
      proveedor: "youtube",
      id: "dQw4w9WgXcQ",
    });
    expect(videoEmbebible("https://vimeo.com/123456")).toMatchObject({
      proveedor: "vimeo",
      id: "123456",
    });
    expect(videoEmbebible("http://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(videoEmbebible("https://cliente.example/video.mp4")).toBeNull();
  });
});
