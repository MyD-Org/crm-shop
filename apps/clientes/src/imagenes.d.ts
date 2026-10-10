// Tipos de los imports estáticos de imágenes (`import logo from "./x.png"`).
// Next los declara en next-env.d.ts, que no se versiona: sin esto el
// typecheck de CI (que no corre next) no los encuentra.
/// <reference types="next/image-types/global" />
