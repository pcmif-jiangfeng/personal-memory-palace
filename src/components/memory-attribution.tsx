import type { Memory } from "@/domain/models";

export function MemoryAttribution({
  memory,
}: {
  memory: Pick<Memory, "createdByDisplayName" | "lastEditedByDisplayName">;
}) {
  return (
    <p className="field-help memory-attribution">
      <span>
        {memory.createdByDisplayName ? `由 ${memory.createdByDisplayName} 创建` : "创建者未记录"}
      </span>
      {" · "}
      <span>
        {memory.lastEditedByDisplayName
          ? `最后由 ${memory.lastEditedByDisplayName} 编辑`
          : "最后编辑者未记录"}
      </span>
    </p>
  );
}
