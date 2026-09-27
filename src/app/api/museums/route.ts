import { NextResponse } from "next/server";
import { updateOwnMuseumProfileInDatabase } from "@/data/museum-profile";
import { parseUpdateMuseumProfile } from "@/http/museum-profile";
import { getDatabase } from "@/data/database";
import { createOwnMuseumInDatabase } from "@/data/museum-onboarding";
import { updateOwnMuseumSlugInDatabase } from "@/data/museum-slug";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseCreateMuseum } from "@/http/museum-onboarding";
import { parseUpdateMuseumSlug } from "@/http/museum-slug";
import { readJsonObject } from "@/http/schemas";
import { ApiError } from "@/http/errors";
import { currentUser } from "@/user-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const input = await parseCreateMuseum(request);
    const museum = createOwnMuseumInDatabase(getDatabase(), user.id, input);
    return NextResponse.json({ id: museum.id, slug: museum.slug }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "museum-onboarding");
  }
}

export async function PATCH(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const input = await readJsonObject(request.clone());
    if (
      input &&
      typeof input === "object" &&
      ["name", "description", "coverPhotoId"].some((field) => field in input)
    ) {
      if ("slug" in input) throw new ApiError("SEPARATE_SLUG_UPDATE_REQUIRED", 400);
      const profile = await parseUpdateMuseumProfile(request);
      const museum = updateOwnMuseumProfileInDatabase(getDatabase(), user.id, profile);
      return NextResponse.json({ id: museum.id, slug: museum.slug, version: museum.version });
    }
    const { slug } = await parseUpdateMuseumSlug(request);
    const museum = updateOwnMuseumSlugInDatabase(getDatabase(), user.id, slug);
    return NextResponse.json({ id: museum.id, slug: museum.slug });
  } catch (error) {
    return apiErrorResponse(error, "museum-slug-update");
  }
}
