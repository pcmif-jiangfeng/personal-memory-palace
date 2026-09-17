import { NextResponse } from "next/server";
import { isOwner } from "@/auth";
import { configureShare, disableShare } from "@/data/share-repository";
import { apiErrorResponse, ownerRequiredResponse } from "@/http/api-error";
import { parseShareConfiguration } from "@/http/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isOwner())) return ownerRequiredResponse();
  try {
    const input = await parseShareConfiguration(request);
    if (!input.enabled) {
      disableShare(input.memoryId);
      return NextResponse.json({ ok: true });
    }
    const token = configureShare(input.memoryId, input.mode, input.password);
    return NextResponse.json({ token, url: `/share/${token}` });
  } catch (error) {
    return apiErrorResponse(error, "configure-share");
  }
}
