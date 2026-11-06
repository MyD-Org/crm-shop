import type { MetadataRoute } from "next";
import { reglasRobots } from "@/lib/seo";
import { esSitioSecundarioDelEntorno, urlCanonicaDelSitio } from "@/lib/sitio-url";

export default function robots(): MetadataRoute.Robots {
  return reglasRobots(urlCanonicaDelSitio(), esSitioSecundarioDelEntorno());
}
