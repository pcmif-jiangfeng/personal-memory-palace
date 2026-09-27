export function restoreBackup(options: {
  backupDirectory: string;
  targetDataDirectory: string;
}): Promise<{ stages: number; memories: number; referencedImages: number }>;
