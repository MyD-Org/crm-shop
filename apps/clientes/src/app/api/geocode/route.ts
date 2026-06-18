import { NextResponse } from "next/server";

interface NominatimResult {
  display_name: string;
  address: {
    road?: string;
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    postcode?: string;
    state?: string;
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text");

  if (!text || text.trim().length < 3) return NextResponse.json([]);

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", text);
  url.searchParams.set("countrycodes", "ar");
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("accept-language", "es");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { "User-Agent": "CentralLed-Shop/1.0 (contacto@cliente.example)" },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return NextResponse.json([]);
  }

  if (!res.ok) return NextResponse.json([], { status: res.status });

  const data = (await res.json()) as NominatimResult[];

  const suggestions = data.map((r) => {
    const addr = r.address;
    const calle = [addr.road, addr.house_number].filter(Boolean).join(" ");
    const ciudad = addr.city ?? addr.town ?? addr.village ?? "";
    const cp = addr.postcode ?? "";
    const label = [calle, ciudad, addr.state].filter(Boolean).join(", ");
    return { label, calle, ciudad, cp };
  });

  return NextResponse.json(suggestions);
}
