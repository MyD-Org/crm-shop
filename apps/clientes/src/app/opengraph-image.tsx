import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";
import { sora, type Fuente } from "@/lib/fuente-sora";

/**
 * Imagen de vista previa del sitio (WhatsApp, Facebook, Google…) para toda
 * página que no defina la suya: la ficha de producto usa la foto del producto
 * (src/lib/producto-metadata.ts).
 *
 * Misma identidad que el header: la marca en texto ("Central" + "Led" en el
 * acento, Sora) con la bajada del header, sobre la paleta del tema
 * `calido-azul` (el de por defecto, src/app/globals.css), y a la derecha la
 * foto del hero (STUDIO_IMAGE, public/images/central-led/studio-bell-bamboo-v3.webp)
 * con todas las luces prendidas, pasada a JPG de 1200 px en
 * src/assets/og-fondo.jpg (Satori no lee WebP). Las luces se compusieron una
 * vez con sharp: la capa SVG de InteractiveHero con todas en opacidad 1 y
 * blend `screen`, igual que en el navegador. Si cambian la foto del hero, las
 * luces o el tema, rehacer la copia y los colores.
 */
export const alt = "Central Led — Iluminación y electricidad";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLOR = {
  fondo: "#f8f8f6",
  tinta: "#1c2733",
  suave: "#666e77",
  acento: "#1e5aa8",
};

const TEXTOS = {
  eyebrow: "ILUMINACIÓN · ELECTRICIDAD",
  bajada: "Iluminación, materiales eléctricos y mucho más",
  lugar: "Tienda online · Puerto Iguazú, Misiones",
};

/**
 * Foto y fuentes. Ruta literal (con variables, Turbopack traza el proyecto
 * entero) y `'use cache'`: sin él, cada pedido volvería a leer el disco y a
 * bajar las fuentes. Si Google falla, se dibuja con la fuente por defecto y se
 * reintenta en minutos (perfil `degradado`).
 */
async function recursos() {
  "use cache";
  const foto = await readFile(join(process.cwd(), "src/assets/og-fondo.jpg"), "base64");
  let fuentes: Fuente[] = [];
  try {
    fuentes = await Promise.all([
      sora(700, "CentralLed"),
      sora(400, Object.values(TEXTOS).join("")),
    ]);
  } catch (err) {
    console.error("[opengraph-image] no se pudo cargar Sora:", err);
    cacheLife("degradado");
  }
  return { foto: `data:image/jpeg;base64,${foto}`, fuentes };
}

export default async function OpengraphImage() {
  const { foto, fuentes } = await recursos();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: COLOR.fondo,
          fontFamily: "Sora",
        }}
      >
        <div
          style={{
            width: 640,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 64px 0 80px",
          }}
        >
          <div style={{ fontSize: 22, letterSpacing: 4, color: COLOR.suave }}>{TEXTOS.eyebrow}</div>
          <div
            style={{
              display: "flex",
              marginTop: 18,
              fontSize: 84,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1,
              color: COLOR.tinta,
            }}
          >
            Central<span style={{ marginLeft: 18, color: COLOR.acento }}>Led</span>
          </div>
          <div style={{ width: 72, height: 4, marginTop: 40, background: COLOR.acento }} />
          <div style={{ marginTop: 36, fontSize: 34, lineHeight: 1.3, color: COLOR.tinta }}>
            {TEXTOS.bajada}
          </div>
          <div style={{ marginTop: 16, fontSize: 24, color: COLOR.suave }}>{TEXTOS.lugar}</div>
        </div>
        {/* Mitad derecha de la foto (lámparas): 945×630 recortada a 560 px. */}
        <div style={{ width: 560, height: "100%", display: "flex", overflow: "hidden" }}>
          <img src={foto} alt="" width={945} height={630} style={{ marginLeft: -385 }} />
        </div>
      </div>
    ),
    { ...size, fonts: fuentes.length ? fuentes : undefined },
  );
}
