import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";
import { sora, type Fuente } from "@/lib/fuente-sora";
import { getMarca } from "@/lib/marca";
import { MARCA_POR_DEFECTO, PARTES_NOMBRE_CENTRAL, type Marca } from "@/lib/marca-base";

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
 *
 * Marca propia (`tenants.shop_marca`): textos, nombre e imagen salen de `getMarca()`. La de Central
 * (base "central" con su nombre) se dibuja EXACTAMENTE como antes, con la foto del hero; cualquier
 * otra, sobre fondo liso con su nombre, sus textos y, si la cargó, su imagen (PNG/JPG: Satori no
 * lee SVG ni WebP). OJO: `alt` debe ser un literal (Next lo lee en el build), así que sigue siendo
 * el de Central y no se puede derivar de la marca.
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

/**
 * Foto y fuentes. Ruta literal (con variables, Turbopack traza el proyecto
 * entero) y `'use cache'`: sin él, cada pedido volvería a leer el disco y a
 * bajar las fuentes. Si Google falla, se dibuja con la fuente por defecto y se
 * reintenta en minutos (perfil `degradado`).
 */
async function recursos(conFoto: boolean, nombre: string, textos: string) {
  "use cache";
  const foto = conFoto ? await readFile(join(process.cwd(), "src/assets/og-fondo.jpg"), "base64") : null;
  let fuentes: Fuente[] = [];
  try {
    fuentes = await Promise.all([sora(700, nombre), sora(400, textos)]);
  } catch (err) {
    console.error("[opengraph-image] no se pudo cargar Sora:", err);
    cacheLife("degradado");
  }
  return { foto: foto ? `data:image/jpeg;base64,${foto}` : null, fuentes };
}

/** La imagen de Central: la foto del hero a la derecha y "Central" + "Led" en el acento. */
function esCentral(marca: Marca): boolean {
  return marca.base === "central" && marca.nombre === MARCA_POR_DEFECTO.nombre;
}

/** Imagen propia de la marca: Satori sólo lee PNG y JPG. */
function imagenPropia(marca: Marca): string | null {
  if (!marca.ogImagenUrl) return null;
  return /\.(png|jpg)$/i.test(new URL(marca.ogImagenUrl).pathname) ? marca.ogImagenUrl : null;
}

export default async function OpengraphImage() {
  const marca = await getMarca();
  const central = esCentral(marca);
  const propia = central ? null : imagenPropia(marca);
  const textos = marca.ogTextos;
  const { foto, fuentes } = await recursos(
    central,
    central ? PARTES_NOMBRE_CENTRAL.join("") : marca.nombre,
    Object.values(textos).join(""),
  );

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
            width: central || propia ? 640 : 1200,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: central || propia ? "0 64px 0 80px" : "0 80px",
          }}
        >
          {textos.eyebrow ? <div style={{ fontSize: 22, letterSpacing: 4, color: COLOR.suave }}>{textos.eyebrow}</div> : null}
          <div
            style={{
              display: "flex",
              marginTop: 18,
              fontSize: central || marca.nombre.length <= 14 ? 84 : 60,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1,
              color: COLOR.tinta,
            }}
          >
            {central ? (
              <>
                {PARTES_NOMBRE_CENTRAL[0]}
                <span style={{ marginLeft: 18, color: COLOR.acento }}>{PARTES_NOMBRE_CENTRAL[1]}</span>
              </>
            ) : (
              marca.nombre
            )}
          </div>
          <div style={{ width: 72, height: 4, marginTop: 40, background: COLOR.acento }} />
          {textos.bajada ? (
            <div style={{ marginTop: 36, fontSize: 34, lineHeight: 1.3, color: COLOR.tinta }}>{textos.bajada}</div>
          ) : null}
          {textos.lugar ? <div style={{ marginTop: 16, fontSize: 24, color: COLOR.suave }}>{textos.lugar}</div> : null}
        </div>
        {/* Mitad derecha de la foto (lámparas): 945×630 recortada a 560 px. */}
        {foto ? (
          <div style={{ width: 560, height: "100%", display: "flex", overflow: "hidden" }}>
            <img src={foto} alt="" width={945} height={630} style={{ marginLeft: -385 }} />
          </div>
        ) : propia ? (
          <div style={{ width: 560, height: "100%", display: "flex", overflow: "hidden" }}>
            <img src={propia} alt="" width={560} height={630} style={{ objectFit: "cover" }} />
          </div>
        ) : null}
      </div>
    ),
    { ...size, fonts: fuentes.length ? fuentes : undefined },
  );
}
