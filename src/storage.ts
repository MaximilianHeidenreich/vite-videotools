import { log } from "./utils.ts";
import { S3Client } from "bun";

export interface S3StorageConfig {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
}

export abstract class StorageAdapter {
  abstract hasFile(path: string): Promise<boolean>;
  abstract uploadFile(localPath: string, remotePath: string): Promise<string>;
}

export class R2StorageAdapter extends StorageAdapter {
  private client: S3Client;

  constructor(config: S3StorageConfig) {
    super();
    this.client = new S3Client(config);
  }

  override hasFile(path: string): Promise<boolean> {
    return this.client.exists(path);
  }

  override async uploadFile(
    localPath: string,
    remotePath: string,
  ): Promise<string> {
    try {
      const file = Bun.file(localPath);

      const writer = this.client.file(remotePath).writer({
        retry: 3,
        queueSize: 10,
        partSize: 5 * 1024 * 1024,
      });

      const stream = file.stream();
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(value);
      }

      await writer.end();

      return Promise.resolve(remotePath);
    } catch (error) {
      log.error(error);
      return Promise.reject(error);
    }
  }
}
