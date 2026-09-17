import { NextResponse } from "next/server";
import { findRandomActiveMemory } from "@/data/memory-repository";
import { isOwner } from "@/auth";
import { ownerRequiredResponse } from "@/http/api-error";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isOwner())) return ownerRequiredResponse();
  const memory = findRandomActiveMemory();
  return NextResponse.json({ memory }, { status: memory ? 200 : 404 });
}
