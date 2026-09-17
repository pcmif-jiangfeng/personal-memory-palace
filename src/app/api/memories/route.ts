import { NextResponse } from "next/server";
import { createMemory } from "@/data/memory-write-repository";
import { isOwner } from "@/auth";
import { apiErrorResponse, ownerRequiredResponse } from "@/http/api-error";
import { parseCreateMemory } from "@/http/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isOwner())) return ownerRequiredResponse();
  try {
    const input = await parseCreateMemory(request);
    const memory = createMemory(input);
    return NextResponse.json({ memory }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "create-memory");
  }
}
