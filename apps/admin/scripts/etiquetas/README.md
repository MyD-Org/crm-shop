# Etiquetas para la impresora térmica (TSPL)

Scripts locales para imprimir etiquetas en la impresora de etiquetas USB (TSPL, 203 dpi,
VID `0416` / PID `5011`). Se corren a mano desde `apps/admin`; no forman parte del build.

| Script | Qué hace |
|---|---|
| `lista-sucursal.ts` | Lee de la base (solo lectura) los productos activos con stock en una sucursal, por marca o sufijo de referencia, y arma `lista.json`. |
| `codigos.ts` | De `lista.json` saca etiquetas chicas de 29×20 mm (3 por fila) con nombre + Code128 de la referencia de Alegra. |
| `marca.ts` | Etiqueta grande de 100×150 mm de la tienda: logo, rubro, dirección, WhatsApp y QR a la web. |
| `imprimir.ts` | Manda uno o más `.tspl` directo por USB. |
| `tspl.ts` | Code128B a mano, PNG → bitmap TSPL y carga de dependencias externas. |

## Preparación (una vez)

`usb` (módulo nativo) y `qrcode` no son dependencias del CRM para no sumarlas al build de
Vercel. Se instalan aparte:

```bash
npm i --prefix ~/.etiquetas-deps usb@2.14.0 qrcode@1.5.4
export ETIQUETAS_DEPS=~/.etiquetas-deps
```

`marca.ts` además usa Google Chrome (headless) para dibujar la etiqueta; otra ruta con
`CHROME_PATH`.

## Etiquetas con código de barras (29×20)

```bash
npx tsx --env-file-if-exists=.env.local scripts/etiquetas/lista-sucursal.ts \
  --tenant <id> --sucursal <id> --marca <marca> --salida /tmp/lista.json
npx tsx scripts/etiquetas/codigos.ts /tmp/lista.json /tmp/codigos
npx tsx scripts/etiquetas/imprimir.ts /tmp/codigos-00.tspl
```

- `lista.json` = `[[referencia, nombre, cantidad], …]`; se puede armar o editar a mano.
- Cantidad = stock de la sucursal; `--una` saca una por producto.
- El código lleva la **referencia** de Alegra (es lo que Alegra busca). Alegra no tiene campo
  de código de barras.
- `BARCODE "128"` de la impresora sale el doble de ancho y se corta: por eso el código se
  dibuja con `BAR` de 1 punto por módulo (13 caracteres ≈ 22 mm).
- Las fuentes internas no traen tildes ni ñ (se sacan solas); entran 18 caracteres por línea.
- Tandas de 10 filas (30 etiquetas) por archivo.
- El lector del local es 1D: lee Code128, no QR.

## Etiqueta de la tienda (100×150)

```bash
cp scripts/etiquetas/marca.ejemplo.json scripts/etiquetas/marca.local.json   # completar con los datos reales
cp <logo>.svg scripts/etiquetas/logo.local.svg
npx tsx scripts/etiquetas/marca.ts scripts/etiquetas/marca.local.json /tmp/etiqueta-tienda 1
npx tsx scripts/etiquetas/imprimir.ts /tmp/etiqueta-tienda.tspl
```

- Abrir `/tmp/etiqueta-tienda.png` para revisar antes de imprimir (es la resolución real).
- `logoColores` pasa los colores del SVG a negro; no tocar los `fill` de máscaras.
- La web va en un solo renglón: si no entra, acortar el texto de `web`.
- `gapMm` (default 3) es el espacio entre etiquetas del rollo; si se corre, ajustarlo.
  `densidad` (default 10) para más o menos oscuro. El último argumento es la cantidad de copias.
- Los `*.local.*`, las listas y los `.tspl` están ignorados por git: el repo es público, nada
  de datos reales acá.

## Impresora

- En la Mac, el backend USB de CUPS se cuelga en "Enviando datos" (ni raw ni usb-unidir lo
  arreglan): por eso `imprimir.ts` escribe directo al endpoint USB.
- Un trabajo colgado solo se suelta apagando la impresora.
- Rollo chico: 3 etiquetas de 29×20 por fila; con `SIZE 100 mm,20 mm` / `GAP 2 mm` cada una
  empieza en x = 2, 34 y 66 mm.
