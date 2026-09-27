# F4 历史照片物理目录迁移

本工具将已完成 Museum 归属迁移的历史照片复制到 `uploads/museums/<museumId>/`，校验 SHA-256 后，在一个 SQLite 事务中更新 uploaded_photos、memory_images 和 stage_covers 的文件引用。照片 ID、Memory 内容、展品说明和公开状态不变。

不会在应用启动时自动执行，不删除旧文件，不处理 F5 的独立 Share/Trash 入口。旧目录保留用于回滚，不再是迁移后记录的活动路径；此阶段不提供旧文件清理命令。

## 前提

- 使用当前代码和 Node.js 24，先完成既有数据库及 Legacy Owner 的 Museum 归属迁移。
- 所有上传照片必须属于 active Museum；错误归属、缺失文件、异常跨馆绑定和上传照片记录缺失均拒绝，不自动猜测归属。
- 先按现有流程恢复或调查 pending_uploads 和 photo_deletion_jobs；队列非空时迁移拒绝。
- apply 前停止应用及其他所有数据库/文件写入；`--quiesced` 是操作者对停写的确认，不是工具替你停止服务。
- 备份目录必须位于数据目录外。容量应足够容纳完整 uploads 备份与新复制的照片。

## 使用

在项目目录执行，以下 DATA_DIRECTORY、BACKUP_DIRECTORY 必须替换成实际绝对路径；不要复制占位符直接执行。

只检查计划和旧文件，不修改数据库或复制照片：

```sh
node --experimental-strip-types scripts/migrate-photo-storage.ts DATA_DIRECTORY
```

停止应用写入后执行：

```sh
node --experimental-strip-types scripts/migrate-photo-storage.ts DATA_DIRECTORY BACKUP_DIRECTORY --apply --quiesced
```

返回 planned、migrated、backupDirectory。执行前自动使用现有 backup.mjs 备份数据库和整个 uploads 树，包括 owner、demo 和 museums。配置文件本身不修改；若需要连同配置备份，沿用现有带 `--config-file` 的手动备份流程。

数据库引用只在全部文件复制并校验成功后提交。已存在且内容相同的目标可复用，内容不同则拒绝覆盖。复制过程异常可能留下尚未引用的新文件；旧文件和数据库引用保持不变。中断造成不完整目标时需先调查，不能直接强制覆盖；同一秒内重试可能碰到备份目录重名，等待下一秒或换备份根目录。

迁移后再次 dry-run，应返回 planned=0。重复 apply 也为 no-op，不再创建备份。

## 验收与恢复

1. 将返回的 backupDirectory 恢复到一个全新的空目录，确认数据库完整性及照片引用；现有 restore-backup.mjs 会检查引用文件存在。
2. 应用重启后检查照片库、原图、缩略图、Memory 展品及 Stage 封面。预览缓存不复制，会按新键重新生成。
3. 回滚时停止应用写入，使用迁移前备份恢复到新的空目录，再将服务指向恢复目录。不要只把数据库覆盖到仍在运行的数据目录。

```sh
node scripts/restore-backup.mjs BACKUP_DIRECTORY NEW_EMPTY_RESTORE_DIRECTORY
```

回滚会恢复到备份时点；若迁移后已产生新内容，先另行备份并核对这些新增数据，不能直接切回旧快照。

## 开发验证

`tests/photo-storage-migration.test.ts` 使用临时数据库和合成文件，覆盖原图/优化图内容保留、Memory/Stage 引用更新、重复运行、迁移前回滚、迁移后 Museum 文件备份恢复、异常绑定和未完成队列拒绝、目标冲突保护、符号链接拒绝、非法路径及缺失源文件拒绝。旧备份测试仍通过。

工具复用标准库和现有备份实现，无新依赖。仅在隔离测试数据上执行过迁移；真实本地/腾讯云历史照片尚未迁移。
