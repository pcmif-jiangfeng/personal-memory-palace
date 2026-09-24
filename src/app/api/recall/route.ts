import { NextResponse } from "next/server";
import { findRandomActiveMemory } from "@/data/memory-repository";
import { isOwner } from "@/auth";

export const runtime = "nodejs";

export async function GET() {
  const memory = findRandomActiveMemory(!(await isOwner()));
  return NextResponse.json({ memory });
}
