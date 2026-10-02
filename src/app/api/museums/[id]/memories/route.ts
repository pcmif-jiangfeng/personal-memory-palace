import { NextResponse } from "next/server";
import { currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { createMemoryInDatabase } from "@/data/memory-write-repository";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseCreateMemory } from "@/http/schemas";
import { requireMuseumOwnerInDatabase } from "@/data/museum-access";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const { id } = await params;
    requireMuseumOwnerInDatabase(getDatabase(), user.id, id);
    const input = await parseCreateMemory(request);
    const memory = createMemoryInDatabase(getDatabase(), input, { userId: user.id, museumId: id });
    return NextResponse.json({ memory }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "create-museum-memory");
  }
}
