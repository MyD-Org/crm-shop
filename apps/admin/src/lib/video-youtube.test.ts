import { describe, it, expect } from "vitest"
import { idYoutubeDeEnlace, validarVideos, MAX_VIDEOS } from "./video-youtube"

const ID = "dQw4w9WgXcQ"

describe("idYoutubeDeEnlace", () => {
  it("acepta watch, youtu.be, shorts y embed, con o sin www/m", () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=10s`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `  https://youtu.be/${ID}  `,
    ]) {
      expect(idYoutubeDeEnlace(url), url).toBe(ID)
    }
  })

  it("rechaza http, otros proveedores y archivos", () => {
    for (const url of [
      `http://youtu.be/${ID}`,
      "https://vimeo.com/123456",
      "https://cdn.example/video.mp4",
      `https://youtube.example/watch?v=${ID}`,
      `https://notyoutube.com/watch?v=${ID}`,
    ]) {
      expect(idYoutubeDeEnlace(url), url).toBeNull()
    }
  })

  it("rechaza ids inválidos y entradas que no son enlaces", () => {
    for (const url of ["https://youtu.be/corto", `https://youtu.be/${ID}x`, "https://www.youtube.com/watch", "https://www.youtube.com/", "no es un enlace", "", null, 5]) {
      expect(idYoutubeDeEnlace(url as unknown), String(url)).toBeNull()
    }
  })
})

describe("validarVideos", () => {
  it("acepta una lista válida", () => {
    expect(validarVideos([{ id: ID }])).toEqual({ ok: true, videos: [{ id: ID }] })
    expect(validarVideos([])).toEqual({ ok: true, videos: [] })
  })

  it("descarta propiedades extra: sólo se conserva el id", () => {
    expect(validarVideos([{ id: ID, url: "https://x.example" }])).toEqual({ ok: true, videos: [{ id: ID }] })
  })

  it("rechaza lo que no es lista, ids inválidos, duplicados y exceso, con mensajes en usted", () => {
    expect(validarVideos("x")).toMatchObject({ ok: false, error: expect.stringMatching(/^Indique /) })
    expect(validarVideos([{ id: "corto" }])).toEqual({ ok: false, error: "Ingrese un enlace de YouTube." })
    expect(validarVideos([null])).toMatchObject({ ok: false })
    expect(validarVideos([{ id: ID }, { id: ID }])).toEqual({ ok: false, error: "Ese video ya está cargado." })
    const cuatro = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"].map((id) => ({ id }))
    expect(cuatro.length).toBeGreaterThan(MAX_VIDEOS)
    expect(validarVideos(cuatro)).toEqual({ ok: false, error: "Se admiten hasta 3 videos por producto." })
  })
})
