# Precios de lista privada (cuentas corrientes)

Change `listas-cuenta-corriente`, rebanada C. Reemplaza al precio especial #219 (flag
`precio-especial-cuenta`, retirado).

## Regla

Un comprador ve y paga el precio de una **lista online privada** del CRM si y sólo si:

1. Su identidad está vinculada a un contacto de Alegra (`identidadActual().cliente`).
2. Ese contacto es **cuenta corriente** (`tipo_cuenta = 'corriente'`, del espejo `alegra_contacts_shop`).
3. Ese contacto tiene una **lista de precios** asignada en Alegra (`price_list_id`).
4. El admin enlazó esa lista de Alegra a una lista privada (`lista_precio_alegra_mapeo_shop`).

En cualquier otro caso (anónimo, sin vincular, contado, sin lista, sin enlace) rige el precio
público, con "$X con medio" y cuotas como siempre.

## Clave del contacto

El enlace se resuelve por **(tenant, cuenta de Alegra, id de la lista de Alegra)**. Hoy el Shop lee
el espejo de contactos sólo de la cuenta `principal` (`CUENTA_ALEGRA_PRINCIPAL`): los clientes de la
cuenta de la sucursal MDP quedan en precio público hasta que exista el espejo de contactos por
cuenta (change `contactos-por-cuenta`). No hay que cambiar el modelo: sólo pasar la cuenta correcta a
`resolverListaCuenta`.

## Dónde vive cada pieza

| Pieza | Archivo |
| --- | --- |
| Regla pura | `src/lib/lista-cuenta.ts` |
| Resolución con DB y sesión (`listaPrivadaDelComprador`) | `src/lib/lista-cuenta-repo.ts` |
| Lectura de precios privados (única consulta a la vista privada) | `src/lib/precios-privados-repo.ts` |
| Cotización (rama privada) | `src/lib/cotizacion.ts` (`idListaPrivada`) |
| Overlay para el navegador | `GET /api/precios-cuenta` + `src/hooks/usePreciosCuenta.ts` |
| Estado del precio en el navegador (marcador, Consulte) | `src/lib/precios-cuenta-estado.ts` |

## Reglas que no se pueden romper

- **El precio por usuario nunca entra en una caché compartida.** Ningún módulo con `'use cache'`
  (incluido el `'use cache: remote'` del catálogo) importa la lectura privada ni la resolución de la
  lista. Lo vigila `src/lib/precios-privados-guarda.test.ts`.
- La lista **sólo sale de la sesión** en el servidor. Ni la URL ni el body del navegador la indican.
- `shop_app` lee los precios privados únicamente por la vista `catalog_products_shop_privados`; la
  vista pública del catálogo no los trae.
- Un precio privado se muestra **siempre**, aunque sea mayor que el público. Sin precio en su lista
  el producto queda en **"Consulte"**: no se agrega al carrito y no se puede confirmar un pedido que
  lo incluya (`/api/pedidos` responde 409 `sin_precio_cuenta`).
- Con lista privada se ignoran el medio de pago como fuente de precio y las cuotas.
- El pedido congela `orders.id_price_list` (id de la lista privada) y el precio neto de cada línea; la
  facturación a Alegra usa ese neto sin cambios.

## Sin parpadeo

El catálogo se renderiza con el precio público. Para quien tiene sesión (pista: cookie
`__client_uat` de Clerk), el precio es un marcador (esqueleto del DS) hasta que llega
`/api/precios-cuenta`. Los anónimos nunca ven marcador. Si el overlay falla, o dice
`conLista: false`, queda el público. Limitación conocida: el primer pintado del HTML estático
(antes de hidratar) todavía trae el precio público; eliminarlo del todo requiere que el DS admita un
precio "en espera" o renderizar la página por usuario.

## Despliegue

Tras el merge, borrar el flag `precio-especial-cuenta` en Vercel Flags (ya no se lee). El enlace
lista de Alegra → lista privada se carga en el admin; mientras no haya enlaces, nadie ve precios
privados.
