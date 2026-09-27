export function createBackup(options: {
  dataDirectory: string;
  backupRoot: string;
  now?: Date;
  applicationVersion?: string;
  quiesced?: boolean;
  configFile?: string;
}): Promise<string>;
