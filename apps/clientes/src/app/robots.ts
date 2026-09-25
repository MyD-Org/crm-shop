import type { MetadataRoute } from "next";
import { reglasRobots } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return reglasRobots(process.env.NEXT_PUBLIC_SITE_URL);
}
