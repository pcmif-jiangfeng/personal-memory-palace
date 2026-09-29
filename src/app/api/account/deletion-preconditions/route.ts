import { NextResponse } from "next/server";
import { currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { checkAccountDeletionPreconditionsInDatabase } from "@/data/account-deletion-preconditions";
import { readAccountDeletionPage } from "@/http/account-deletion-preconditions";
import { apiErrorResponse } from "@/http/api-error";
import { ApiError } from "@/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => key !== "page"))
      throw new ApiError("INVALID_DELETION_QUERY", 400);
    const pages = query.getAll("page");
    const page = readAccountDeletionPage(pages.length > 1 ? pages : pages[0]);
    return NextResponse.json(
      checkAccountDeletionPreconditionsInDatabase(getDatabase(), user.id, page),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return apiErrorResponse(error, "account-deletion-preconditions");
  }
}
