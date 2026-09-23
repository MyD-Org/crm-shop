This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Setup: acceso al design system

`@myd-org/ui` se publica en GitHub Packages (privado), no en npmjs. Antes del
primer `npm install` hay que configurar el acceso **fuera del repo** — el
`.npmrc` no se commitea, para que el token nunca viva en el codigo.

**Local:** agregar a `~/.npmrc` (token con scope `read:packages`, generado en
GitHub > Settings > Developer settings > Tokens classic):

```
@myd-org:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=TU_TOKEN
```

**Vercel:** variable de entorno `NPM_RC` con el contenido de ese archivo, mas
la linea del registry publico. Vercel lo escribe como `.npmrc` en el build
([docs](https://vercel.com/kb/guide/using-private-dependencies-with-vercel)):

```
registry=https://registry.npmjs.org/
@myd-org:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=TU_TOKEN
```

## Base de datos

El shop tiene **su propio Postgres** (separado del CRM — ver
`docs/arquitectura-integraciones.md`). Hoy guarda el espejo del catálogo de
Alegra, que refresca la sync diaria (GitHub Actions, ver más abajo).

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión de la app en tiempo de ejecución. Pooled, rol `shop_app`. Es la única variable que lee el runtime. |
| `MIGRATE_DATABASE_URL` | Solo para `npm run db:migrate`. Conexión directa (sin pooler), rol dueño del esquema `shop`. El runtime nunca la usa. |
| `SHOP_TENANT_ID` | Obligatoria: el Shop no arranca sin ella (falla en `src/instrumentation.ts`, salvo durante `next build`). Tiene que ser un valor de `public.tenants.id` del CRM. |
| `CRON_SECRET` | Protege `/api/cron/catalog-sync` y `/api/cron/cuotas-sync`. Sin esta variable el endpoint rechaza todo. |
| `ALEGRA_EMAIL` / `ALEGRA_TOKEN` | Auth Basic contra la API de Alegra. `ALEGRA_BASE_URL` es opcional (default: producción). |
| `CRM_INTERNAL_URL` | Base URL del CRM del mismo entorno. La sync de cuotas lee `GET /api/internal/shop/cuotas` (contrato v2: escalones por proveedor). |
| `SHOP_CRM_SECRET` | Llave propia Shop↔CRM (mismo valor en el proyecto del CRM; NO es el `INTERNAL_SECRET` de ai-api): Bearer hacia el CRM y protección de `POST /api/internal/cuotas/revalidar`. |
| `SHOP_MEDIA_HOSTS` | Hosts de las fotos del overlay, separados por coma (ej. `media.plataforma.example`). Alimenta `images.remotePatterns`; sin ella las cards muestran el placeholder. Debe incluir el host de `R2_SHOP_MEDIA_PUBLIC_URL`; si no, el editor de la home rechaza las imágenes subidas. Se lee en el build y en runtime: un cambio requiere redesplegar. |
| `R2_SHOP_MEDIA_ACCOUNT_ID` (o `R2_ACCOUNT_ID`) | Cuenta de Cloudflare del bucket público `shop-media`. Mismo par que el proyecto del CRM (rotarlo implica actualizar los dos proyectos de Vercel). |
| `R2_SHOP_MEDIA_ACCESS_KEY_ID` | Llave de acceso para firmar las subidas a `shop-media`. Mismo par que el CRM. |
| `R2_SHOP_MEDIA_SECRET_ACCESS_KEY` | Secreto de la llave anterior. Mismo par que el CRM. |
| `R2_SHOP_MEDIA_BUCKET` | Bucket público (`shop-media`). Mismo par que el CRM. |
| `R2_SHOP_MEDIA_PUBLIC_URL` | Base pública desde donde se sirven las imágenes (sin barra final; ejemplo `https://media.plataforma.example`). Mismo par que el CRM. |

### Flags (Vercel Flags, sin redeploy)

Los interruptores del Shop viven en Vercel Flags (`src/flags.ts`), no en variables
de entorno: se cambian desde el dashboard del proyecto o con
`vercel flags enable|disable <key> --environment production` y aplican en el
próximo request. Todos arrancan apagados y, si Vercel Flags no responde, se
sirven apagados.

| Flag | Prendido |
|---|---|
| `pagos` | El checkout muestra "Forma de pago" (transferencia, Mercado Pago, efectivo). Apagado: sólo "a coordinar", sin cobros. |
| `cuotas` | Muestra cuotas y aplica el límite de cuotas en el pago. Apagado: checkout sin cuotas, clamp 1..24. |
| `catalogo-solo-visibles` | Sólo productos publicados (`visible`) en el overlay del CRM. Fail-closed: encenderlo sin curaduría vacía la tienda. Ver `docs/catalogo-overlay.md`. |
| `envio` | El checkout ofrece envío a domicilio (ciudades y mínimo de `src/lib/envio.ts`) y Mi cuenta lo anuncia. Apagado: sólo retiro / entrega a coordinar; `POST /api/pedidos` rechaza el envío. |

Los flags nuevos van en Vercel Flags, no como variable `=1`.

Detalle del esquema `shop` (rol, permisos, migración base y pasos de
despliegue): `docs/una-base-esquema-shop.md`.

**Rol admin del Shop**: en Clerk → Users → Metadata → Public, `{"role":"admin"}`.
Habilita el modo edición de la home (`/`): editar cada sección in-place, sin
pasar por el CRM (server actions en `src/lib/home-acciones.ts`).

## Imágenes de la home (R2)

El admin sube imágenes desde el editor in-place de la home (`/`, sección por
sección). El flujo es: el navegador redimensiona la imagen a una variante
webp de 1600 px, pide al servidor una URL PUT prefirmada
(`firmarSubidaImagenHome`, `src/lib/home-acciones.ts`) y sube el archivo
directo al bucket público `shop-media`, bajo el prefijo `home/{tenant}/`. La
URL pública resultante se guarda recién al pulsar "Guardar" en el Dialog de
la sección. No hay borrado de objetos huérfanos (si se cancela después de
subir, el objeto queda aceptado en el bucket).

**CORS del bucket** (Cloudflare R2 → `shop-media` → Settings → CORS): agregar
los orígenes del Shop de forma explícita — producción, `http://localhost:3000`
y cualquier preview que se vaya a probar — con `AllowedMethods: ["PUT"]` y
`AllowedHeaders: ["content-type"]`, sin comodín. Conservar los orígenes que ya
usa el CRM. Referencia: `apps/admin/docs/DEPLOY.md`.

El pool de conexiones es un singleton (se reusa; uno por request agotaría las
conexiones de Postgres). Está cacheado **junto a la URL con la que se creó**, así
que si cambiás de base en el `.env.local` se reconecta solo en la próxima query
y lo avisa por consola — no hace falta reiniciar `next dev`.

Migraciones:

```bash
npm run db:generate   # genera SQL en drizzle/ a partir de src/db/schema.ts (no conecta a ninguna base)
npm run db:migrate    # las aplica usando MIGRATE_DATABASE_URL (rol dueño, conexión directa)
```

Sync del catálogo (primera carga, o para correrla a mano):

```bash
npm run sync:catalogo
```

Corre el proceso completo contra la base de `DATABASE_URL`. Existe también la
ruta HTTP, cómoda en dev pero limitada por el timeout de la función:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/catalog-sync
```

Sync de cuotas (planes de Mercado Pago + config del CRM; cada fuente conserva
su última copia buena si falla):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/cuotas-sync
```

Tarda un rato: recorre ~5959 ítems paginando de a 30 (~3 min). Cada corrida deja
registro en `catalog_sync_log` (`status`, `items_synced`, `error`).

## Tareas programadas

| Tarea | Dónde corre | Cuándo |
|---|---|---|
| Sync del catálogo | GitHub Actions — `.github/workflows/catalogo-sync.yml` | 06:00 UTC, diaria |
| Sync de cuotas | Vercel Cron — `vercel.json` → `/api/cron/cuotas-sync` | 12:00 UTC, diaria |
| Reconciliar pagos MP | GitHub Actions — `.github/workflows/pagos-reconciliar.yml` | cada 15 min |

La sync del catálogo se mudó de Vercel Cron a Actions porque dejó de entrar en
los 300 s que topea una función en el plan Hobby: el catálogo creció a ~5959
ítems y Alegra pagina de a 30 y responde 429 si se lo apura. El workflow no
llama al endpoint — **ejecuta la sync adentro del runner**, que no tiene ese
límite.

Secrets que hay que tener cargados en el repo (Settings → Secrets and variables
→ Actions):

| Secret | Para qué |
|---|---|
| `ALEGRA_EMAIL` | Sync del catálogo: auth contra Alegra. |
| `ALEGRA_TOKEN` | Sync del catálogo: auth contra Alegra. |
| `DATABASE_URL` | Sync del catálogo: conexión directa a Neon (sin pooler), rol `shop_app`. |
| `ALEGRA_BASE_URL` | Opcional. Solo para apuntar a otro host de Alegra. |
| `CRON_SECRET` | Reconciliación de pagos: Bearer del endpoint. Mismo valor que en Vercel Production. |

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

> Parte del monorepo `crm-shop`: todos los comandos se corren parados en esta carpeta (`apps/clientes`).

## Deploy

Esta app vive en `apps/clientes` del monorepo `crm-shop`. En su proyecto de Vercel, **Root Directory = `apps/clientes`**; Install y Build Command quedan en sus valores por defecto. El Ignored Build Step evita redeploys cuando el cambio no toca esta carpeta. Los workflows programados están en `.github/workflows/clientes-*.yml` de la raíz y usan secrets con prefijo `CLIENTES_`. La variable `NEXT_PUBLIC_CRM_URL` es obligatoria en Production y Preview.

Instrucciones para agentes: `AGENTS.md` de esta carpeta y el de la raíz del repo.
