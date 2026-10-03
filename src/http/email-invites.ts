import { ApiError } from "./errors.ts";
import { readJsonObject } from "./schemas.ts";

export async function parseEmailInviteCreation(request: Request) {
  const input = await readJsonObject(request);
  if (Object.keys(input).some((key) => key !== "targetEmail"))
    throw new ApiError("INVALID_INVITE_INPUT", 400);
  if (typeof input.targetEmail !== "string") throw new ApiError("INVALID_EMAIL", 400);
  const targetEmail = input.targetEmail.trim().toLowerCase();
  if (targetEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail))
    throw new ApiError("INVALID_EMAIL", 400);
  return { targetEmail };
}

export async function parseEmailInviteAcceptance(request: Request) {
  const input = await readJsonObject(request);
  if (Object.keys(input).some((key) => key !== "inviteId"))
    throw new ApiError("INVALID_INVITE_INPUT", 400);
  if (
    typeof input.inviteId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.inviteId)
  )
    throw new ApiError("INVALID_INVITE_ID", 400);
  return { inviteId: input.inviteId };
}
