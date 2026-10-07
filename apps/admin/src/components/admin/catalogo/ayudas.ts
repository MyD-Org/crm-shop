// Textos de ayuda del catálogo (tooltips). Registro: usted / impersonal, como el resto del admin.
// Describen el comportamiento REAL de la tienda con los flags `sucursales` y
// `disponibilidad-sucursal` prendidos (apps/clientes/src/lib/stock-sucursal.ts): si esa regla
// cambia, estos textos cambian con ella.

export const AYUDA_ESTADO =
  "Publicado: se muestra en la tienda. Oculto: se ocultó desde este panel. No se publica: está visible, pero no tiene precio o está dado de baja en Alegra."

export const AYUDA_STOCK_SUCURSALES =
  "Arriba, el stock de la cuenta de origen del producto. Debajo, el de cada sucursal según su cuenta de Alegra; «—» indica que todavía no hay dato de esa sucursal."

export const AYUDA_CUENTA_ORIGEN =
  "Cuenta de Alegra de la que se toman el nombre, el precio y la descripción. En los productos que están en más de una cuenta manda la principal."

export const AYUDA_VISIBLE_EN =
  "Indica qué sucursales venden el producto. Donde está oculto, esa sucursal no cuenta su stock ni permite retirarlo allí; el cliente lo sigue viendo y puede pedirlo con envío desde otra sucursal. Solo deja de mostrarse en la tienda si está oculto en todas."

export const AYUDA_OCULTO_EN =
  "Esta sucursal no ofrece el producto: no cuenta su stock ni permite retirarlo allí. Las demás sucursales lo siguen vendiendo."

export const AYUDA_SOLO_EN =
  "El producto existe únicamente en la cuenta de Alegra de esta sucursal."

export const AYUDA_DESTACADO =
  "Se muestra primero en su categoría y en las que la contienen. Se cambia desde Editar, con «Destacar en la categoría»."

export const AYUDA_PUBLICAR =
  "Muestra los productos en la tienda. No cambia en qué sucursales se ofrecen."

export const AYUDA_OCULTAR =
  "Saca los productos de la tienda en todas las sucursales. Para dejar de ofrecerlos en una sola, use «Visibilidad por sucursal»."
