// Genera los íconos de app de Central (pantalla de inicio de iOS y Android) desde el favicon
// (src/app/icon.svg), para que sean el mismo dibujo: disco azul marino, anillo de color y pin relleno.
// - icon-192 / icon-512: el ícono tal cual (esquinas transparentes).
// - apple-icon: fondo azul marino de borde a borde (iOS pinta de negro lo transparente y redondea solo).
// - icon-maskable-512: fondo azul marino y el ícono al 80 %, dentro de la zona segura que Android recorta.
// Uso: node scripts/iconos-app.mjs
import { readFileSync } from "node:fs";
import sharp from "sharp";

const NAVY = "#162133";
const svg = readFileSync(new URL("../src/app/icon.svg", import.meta.url));
const destino = (f) => new URL(`../public/images/central-led/${f}`, import.meta.url).pathname;
const icono = (lado) => sharp(svg, { density: 300 }).resize(lado, lado).png().toBuffer();
const fondo = (lado) => sharp({ create: { width: lado, height: lado, channels: 4, background: NAVY } });

await sharp(await icono(192)).png({ compressionLevel: 9 }).toFile(destino("icon-192.png"));
await sharp(await icono(512)).png({ compressionLevel: 9 }).toFile(destino("icon-512.png"));
await fondo(180).composite([{ input: await icono(180) }]).png({ compressionLevel: 9 }).toFile(destino("apple-icon.png"));
const interno = Math.round(512 * 0.8);
await fondo(512)
  .composite([{ input: await icono(interno), left: (512 - interno) / 2 | 0, top: (512 - interno) / 2 | 0 }])
  .png({ compressionLevel: 9 })
  .toFile(destino("icon-maskable-512.png"));
console.log("íconos de app generados");
