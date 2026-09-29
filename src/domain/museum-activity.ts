// Opt in each safe content event; new audit actions are private until explicitly reviewed.
export const museumActivityMessages: Readonly<Record<string, string>> = Object.freeze({
  "memory.create": "创建了一段记忆",
  "memory.details": "修改了一段记忆",
  "memory.note": "为记忆添加了后记",
  "memory.relations": "调整了记忆关联",
  "memory.addPhotos": "为记忆添加了照片",
  "memory.removePhoto": "移除了记忆中的照片",
  "memory.reorderPhotos": "调整了记忆中的照片顺序",
  "memory.setCover": "修改了记忆封面",
  "memory.exhibitMetadata": "修改了照片展陈",
  "memory.publication": "调整了记忆的公开范围",
  "memory.trash": "将记忆移入了回收站",
  "memory.restore": "恢复了一段记忆",
  "memory.permanent": "永久删除了一段记忆",
  "stage.create": "创建了一个 Stage",
  "stage.details": "修改了一个 Stage",
  "stage.publication": "调整了 Stage 的公开范围",
  "stage.trash": "将 Stage 移入了回收站",
  "stage.restore": "恢复了一个 Stage",
  "stage.permanent": "永久删除了一个 Stage",
  "photo.upload": "上传了一张照片",
  "photo.archive": "归档了一张照片",
  "photo.deleteQueued": "将照片加入了删除队列",
});

export interface MuseumActivityEntry {
  id: string;
  actorName: string | null;
  summary: string;
  timestamp: string;
}
