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
