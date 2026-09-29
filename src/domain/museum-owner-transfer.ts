export interface MuseumOwnerTransferInput {
  confirm: true;
  targetUserId: string;
  oldOwnerDisposition: "stay" | "leave";
  version: number;
}
