export interface CreateInviteInput {
  useMode: "single-use" | "multi-use";
  maxUses: number | null;
  expiresAt: string | null;
}

export interface InviteSummary extends CreateInviteInput {
  id: string;
  usageCount: number;
  revokedAt: string | null;
  createdAt: string;
}
