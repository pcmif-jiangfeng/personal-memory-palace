import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { resolveStoredImagePath } from "@/storage/local-image-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: segments } = await params;
  const key = segments.join("/");
  if (!/^uploads\/(demo|owner)\/optimized\/[0-9a-f-]+\.webp$/.test(key)) {
    return new NextResponse(null, { status: 404 });
  }
  try {
    const image = await readFile(resolveStoredImagePath(key));
    return new NextResponse(new Uint8Array(image), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
