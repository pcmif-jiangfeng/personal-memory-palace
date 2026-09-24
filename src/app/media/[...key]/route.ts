import { readFile, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isOwner } from "@/auth";
import { isSharedImageAccessible, shareAccessCookieName } from "@/data/share-repository";
import { isPublicImageAccessible } from "@/data/publication-repository";
import {
  readOrCreateImagePreview,
  resolveImagePreviewPath,
  resolveStoredImagePath,
} from "@/storage/local-image-storage";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: segments } = await params;
  const key = segments.join("/");
  if (!/^uploads\/(demo|owner)\/optimized\/[0-9a-f-]+\.webp$/.test(key)) {
    return new NextResponse(null, { status: 404 });
  }
  const variant = new URL(request.url).searchParams.get("variant");
  if (variant !== null && variant !== "thumbnail" && variant !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  if (!(await isOwner())) {
    const token = new URL(request.url).searchParams.get("share");
    const publicImage = isPublicImageAccessible(key);
    const sharedImage =
      token && /^[A-Za-z0-9_-]{10,200}$/.test(token)
        ? isSharedImageAccessible(
            token,
            key,
            (await cookies()).get(shareAccessCookieName(token))?.value,
          )
        : false;
    if (!publicImage && !sharedImage) {
      return new NextResponse(null, { status: 404 });
    }
  }

  try {
    const imagePath = resolveStoredImagePath(key);
    const source = await stat(imagePath);
    const etag = `W/"${source.mtimeMs}-${source.size}-${variant ?? "full"}"`;
    const headers = {
      "Cache-Control": "private, no-cache",
      "Content-Type": "image/webp",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    };
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers });
    }
    const image = variant
      ? await readOrCreateImagePreview(
          imagePath,
          resolveImagePreviewPath(key, variant),
          source.mtimeMs,
          variant,
        )
      : await readFile(imagePath);
    return new NextResponse(new Uint8Array(image), {
      headers,
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
