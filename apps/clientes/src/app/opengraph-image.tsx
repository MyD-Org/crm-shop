import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * Imagen de vista previa del sitio (WhatsApp, Facebook, Google…) para toda
 * página que no defina la suya: la ficha de producto usa la foto del producto
 * (src/lib/producto-metadata.ts). Se genera en el build: no lee el request.
 *
 * El fondo es la foto del hero bajada a 1200 px (src/assets/og-fondo.jpg):
 * el PNG original pesa 2 MB y Satori no lee WebP.
 */
export const alt = "Central LED — Iluminación LED y materiales eléctricos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Fondo y logo como data URL. Rutas literales (con variables, Turbopack traza
 * el proyecto entero) y `'use cache'`: sin él, leer el disco vuelve dinámica
 * la ruta y la imagen se regeneraría en cada pedido.
 */
async function recursos() {
  "use cache";
  const [fondo, logo] = await Promise.all([
    readFile(join(process.cwd(), "src/assets/og-fondo.jpg"), "base64"),
    readFile(join(process.cwd(), "public/images/central-led/logo-mail.png"), "base64"),
  ]);
  return {
    fondo: `data:image/jpeg;base64,${fondo}`,
    logo: `data:image/png;base64,${logo}`,
  };
}

export default async function OpengraphImage() {
  const { fondo, logo } = await recursos();

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative" }}>
        <img
          src={fondo}
          alt=""
          width={1200}
          height={800}
          style={{ position: "absolute", top: -85, left: 0, width: 1200, height: 800 }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 72px",
            width: 720,
            height: "100%",
          }}
        >
          <img src={logo} alt="" width={540} height={69} />
          <div
            style={{
              marginTop: 40,
              fontSize: 52,
              fontWeight: 700,
              lineHeight: 1.15,
              color: "#2b2622",
            }}
          >
            Iluminación LED y materiales eléctricos
          </div>
          <div style={{ marginTop: 20, fontSize: 30, color: "#5c544c" }}>
            Tienda online · Puerto Iguazú, Misiones
          </div>
        </div>
      </div>
    ),
    size,
  );
}
