// Genera public/images/central-led/logo-mail.png desde el logo de la tienda (src/assets/central-led-logo.svg):
// el mismo logo, a 2x del tamaño del mail, sobre una placa blanca redondeada que es parte de la imagen.
// En modo claro no se nota (la tarjeta del mail es blanca); en modo oscuro los clientes de correo oscurecen
// el fondo pero no las imágenes, y "Central" (azul marino) sigue legible sobre la placa.
// Uso: node scripts/logo-mail.mjs
import { readFileSync } from "node:fs";
import sharp from "sharp";

const ALTO_LOGO_2X = 48;
const MARGEN_X = 20;
const MARGEN_Y = 12;
const RADIO = 12;

const svg = readFileSync(new URL("../src/assets/central-led-logo.svg", import.meta.url));
const logo = await sharp(svg, { density: 300 }).resize({ height: ALTO_LOGO_2X }).png().toBuffer();
const { width } = await sharp(logo).metadata();
const ancho = width + MARGEN_X * 2;
const alto = ALTO_LOGO_2X + MARGEN_Y * 2;
const placa = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}"><rect width="${ancho}" height="${alto}" rx="${RADIO}" fill="#ffffff"/></svg>`,
);

const info = await sharp(placa)
  .composite([{ input: logo, left: MARGEN_X, top: MARGEN_Y }])
  .png({ compressionLevel: 9 })
  .toFile(new URL("../public/images/central-led/logo-mail.png", import.meta.url).pathname);
console.log(`logo-mail.png ${info.width}×${info.height}`);
