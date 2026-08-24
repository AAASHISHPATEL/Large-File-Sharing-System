export declare const initializeUpload: (filename: string, totalSize: number) => Promise<string>;
export declare const receiveChunk: (uploadId: string, chunkIndex: number, buffer: Buffer) => Promise<void>;
export declare const completeUpload: (uploadId: string, totalChunks: number) => Promise<string>;
//# sourceMappingURL=uploadService.d.ts.map