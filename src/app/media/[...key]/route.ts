import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isOwner } from "@/auth";
import { isSharedImageAccessible, shareAccessCookieName } from "@/data/share-repository";
import { resolveStoredImagePath } from "@/storage/local-image-storage";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: segments } = await params;
  const key = segments.join("/");
  if (!/^uploads\/(demo|owner)\/optimized\/[0-9a-f-]+\.webp$/.test(key)) {
    return new NextResponse(null, { status: 404 });
  }

  if (!(await isOwner())) {
    const token = new URL(request.url).searchParams.get("share");
    if (!token || !/^[A-Za-z0-9_-]{10,200}$/.test(token)) {
      return new NextResponse(null, { status: 404 });
    }
    const accessCookie = (await cookies()).get(shareAccessCookieName(token))?.value;
    if (!isSharedImageAccessible(token, key, accessCookie)) {
      return new NextResponse(null, { status: 404 });
    }
  }

  try {
    const image = await readFile(resolveStoredImagePath(key));
    return new NextResponse(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
