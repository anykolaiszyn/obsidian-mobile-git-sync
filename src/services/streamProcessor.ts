/**
 * Streaming File Processor
 * 
 * Handles large file operations with streaming, chunked processing,
 * and memory-efficient operations for mobile devices
 */

import { DisposableService } from '../core/container';
import { Logger } from '../utils/logger';

export interface StreamChunk {
  data: Uint8Array;
  offset: number;
  size: number;
  isLast: boolean;
  checksum?: string;
}

export interface StreamOptions {
  chunkSize: number;
  maxMemoryUsage: number; // bytes
  enableCompression: boolean;
  enableChecksums: boolean;
  progressCallback?: (progress: StreamProgress) => void;
  errorCallback?: (error: Error) => void;
}

export interface StreamProgress {
  bytesProcessed: number;
  totalBytes: number;
  percentage: number;
  currentChunk: number;
  totalChunks: number;
  speed: number; // bytes per second
  estimatedTimeRemaining: number; // milliseconds
}

export interface StreamResult {
  success: boolean;
  bytesProcessed: number;
  chunks: number;
  duration: number;
  checksum?: string;
  error?: Error;
}

export class StreamProcessor extends DisposableService {
  private activeStreams = new Map<string, AbortController>();
  private memoryUsage = 0;
  private maxConcurrentStreams = 3;

  private readonly defaultOptions: StreamOptions = {
    chunkSize: 1024 * 1024, // 1MB chunks
    maxMemoryUsage: 50 * 1024 * 1024, // 50MB max memory
    enableCompression: true,
    enableChecksums: true
  };

  constructor(private logger: Logger) {
    super();
    this.setupMemoryMonitoring();
  }

  /**
   * Processes a large file as a stream with chunked operations
   */
  async processFileStream(
    file: File | Blob,
    processor: (chunk: StreamChunk) => Promise<void>,
    options: Partial<StreamOptions> = {}
  ): Promise<StreamResult> {
    this.checkDisposed();

    const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const config = { ...this.defaultOptions, ...options };
    const abortController = new AbortController();
    
    this.activeStreams.set(streamId, abortController);

    const startTime = Date.now();
    let bytesProcessed = 0;
    let chunks = 0;
    let checksum: string | undefined;

    try {
      // Check memory constraints
      if (this.memoryUsage + config.chunkSize > config.maxMemoryUsage) {
        await this.waitForMemoryAvailable(config.maxMemoryUsage - config.chunkSize);
      }

      const totalBytes = file.size;
      const totalChunks = Math.ceil(totalBytes / config.chunkSize);
      let checksumCalculator: any;

      if (config.enableChecksums) {
        checksumCalculator = await this.createChecksumCalculator();
      }

      this.logger.info('Starting file stream processing', {
        component: 'StreamProcessor',
        streamId,
        totalBytes,
        totalChunks,
        chunkSize: config.chunkSize
      });

      // Process file in chunks
      for (let i = 0; i < totalChunks; i++) {
        if (abortController.signal.aborted) {
          throw new Error('Stream processing aborted');
        }

        const offset = i * config.chunkSize;
        const chunkSize = Math.min(config.chunkSize, totalBytes - offset);
        const slice = file.slice(offset, offset + chunkSize);
        
        // Read chunk data
        const arrayBuffer = await this.readBlobAsArrayBuffer(slice);
        const chunkData = new Uint8Array(arrayBuffer);
        
        this.memoryUsage += chunkData.byteLength;

        const chunk: StreamChunk = {
          data: chunkData,
          offset,
          size: chunkSize,
          isLast: i === totalChunks - 1
        };

        // Calculate checksum if enabled
        if (checksumCalculator) {
          checksumCalculator.update(chunkData);
          if (chunk.isLast) {
            checksum = checksumCalculator.digest('hex');
            chunk.checksum = checksum;
          }
        }

        // Process the chunk
        await processor(chunk);

        bytesProcessed += chunkSize;
        chunks++;
        this.memoryUsage -= chunkData.byteLength;

        // Report progress
        if (config.progressCallback) {
          const elapsed = Date.now() - startTime;
          const speed = elapsed > 0 ? (bytesProcessed / elapsed) * 1000 : 0;
          const estimatedTimeRemaining = speed > 0 ? 
            ((totalBytes - bytesProcessed) / speed) : 0;

          config.progressCallback({
            bytesProcessed,
            totalBytes,
            percentage: (bytesProcessed / totalBytes) * 100,
            currentChunk: i + 1,
            totalChunks,
            speed,
            estimatedTimeRemaining
          });
        }

        // Yield control to prevent blocking
        await this.yieldControl();
      }

      const duration = Date.now() - startTime;

      this.logger.info('File stream processing completed', {
        component: 'StreamProcessor',
        streamId,
        bytesProcessed,
        chunks,
        duration,
        avgSpeed: duration > 0 ? (bytesProcessed / duration) * 1000 : 0
      });

      return {
        success: true,
        bytesProcessed,
        chunks,
        duration,
        checksum
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error('File stream processing failed', {
        component: 'StreamProcessor',
        streamId,
        error,
        bytesProcessed,
        chunks
      });

      if (config.errorCallback) {
        config.errorCallback(error instanceof Error ? error : new Error(String(error)));
      }

      return {
        success: false,
        bytesProcessed,
        chunks,
        duration,
        error: error instanceof Error ? error : new Error(String(error))
      };

    } finally {
      this.activeStreams.delete(streamId);
    }
  }

  /**
   * Creates a streaming upload with resumable capabilities
   */
  async streamUpload(
    file: File,
    uploadChunk: (chunk: StreamChunk, uploadUrl: string) => Promise<{ success: boolean; resumeOffset?: number }>,
    uploadUrl: string,
    options: Partial<StreamOptions> = {}
  ): Promise<StreamResult> {
    let resumeOffset = 0;
    
    // Check for existing upload session
    const existingOffset = await this.getResumeOffset(file.name, uploadUrl);
    if (existingOffset > 0) {
      resumeOffset = existingOffset;
      this.logger.info('Resuming upload from offset', {
        component: 'StreamProcessor',
        fileName: file.name,
        resumeOffset
      });
    }

    const resumableFile = resumeOffset > 0 ? 
      file.slice(resumeOffset) : file;

    return this.processFileStream(
      resumableFile,
      async (chunk) => {
        const adjustedChunk = {
          ...chunk,
          offset: chunk.offset + resumeOffset
        };

        const result = await uploadChunk(adjustedChunk, uploadUrl);
        
        if (!result.success) {
          if (result.resumeOffset !== undefined) {
            await this.saveResumeOffset(file.name, uploadUrl, result.resumeOffset);
          }
          throw new Error('Chunk upload failed');
        }

        // Clear resume data on successful completion
        if (chunk.isLast) {
          await this.clearResumeOffset(file.name, uploadUrl);
        }
      },
      options
    );
  }

  /**
   * Creates a streaming download with resume capabilities
   */
  async streamDownload(
    downloadUrl: string,
    downloadChunk: (offset: number, size: number) => Promise<Uint8Array>,
    totalSize: number,
    options: Partial<StreamOptions> = {}
  ): Promise<StreamResult> {
    let resumeOffset = 0;
    
    // Check for existing download session
    const existingOffset = await this.getResumeOffset('download', downloadUrl);
    if (existingOffset > 0) {
      resumeOffset = existingOffset;
    }

    const config = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    let bytesProcessed = 0;
    let chunks = 0;
    
    try {
      const remainingSize = totalSize - resumeOffset;
      const totalChunks = Math.ceil(remainingSize / config.chunkSize);
      
      for (let i = 0; i < totalChunks; i++) {
        const offset = resumeOffset + (i * config.chunkSize);
        const chunkSize = Math.min(config.chunkSize, totalSize - offset);
        
        const chunkData = await downloadChunk(offset, chunkSize);
        
        const chunk: StreamChunk = {
          data: chunkData,
          offset,
          size: chunkSize,
          isLast: offset + chunkSize >= totalSize
        };

        // Process downloaded chunk (could be saving to file, etc.)
        await this.processDownloadedChunk(chunk);
        
        bytesProcessed += chunkSize;
        chunks++;

        // Update resume offset
        if (!chunk.isLast) {
          await this.saveResumeOffset('download', downloadUrl, offset + chunkSize);
        } else {
          await this.clearResumeOffset('download', downloadUrl);
        }

        // Report progress
        if (config.progressCallback) {
          const elapsed = Date.now() - startTime;
          const speed = elapsed > 0 ? (bytesProcessed / elapsed) * 1000 : 0;

          config.progressCallback({
            bytesProcessed: resumeOffset + bytesProcessed,
            totalBytes: totalSize,
            percentage: ((resumeOffset + bytesProcessed) / totalSize) * 100,
            currentChunk: i + 1,
            totalChunks,
            speed,
            estimatedTimeRemaining: speed > 0 ? 
              ((totalSize - resumeOffset - bytesProcessed) / speed) : 0
          });
        }

        await this.yieldControl();
      }

      return {
        success: true,
        bytesProcessed: resumeOffset + bytesProcessed,
        chunks,
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        success: false,
        bytesProcessed: resumeOffset + bytesProcessed,
        chunks,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Compresses data using streaming compression
   */
  async compressStream(
    data: Uint8Array,
    options: { level?: number; algorithm?: 'gzip' | 'deflate' } = {}
  ): Promise<Uint8Array> {
    const { algorithm = 'gzip', level = 6 } = options;
    
    // Use native compression if available
    if ('CompressionStream' in window) {
      const stream = new CompressionStream(algorithm);
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      
      // Write data
      await writer.write(data);
      await writer.close();
      
      // Read compressed result
      const chunks: Uint8Array[] = [];
      let done = false;
      
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          chunks.push(value);
        }
      }
      
      // Combine chunks
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      
      return result;
    }
    
    // Fallback to simple compression simulation
    this.logger.warn('Native compression not available, using fallback', {
      component: 'StreamProcessor'
    });
    
    return data; // Return uncompressed as fallback
  }

  /**
   * Decompresses data using streaming decompression
   */
  async decompressStream(
    compressedData: Uint8Array,
    algorithm: 'gzip' | 'deflate' = 'gzip'
  ): Promise<Uint8Array> {
    if ('DecompressionStream' in window) {
      const stream = new DecompressionStream(algorithm);
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      
      // Write compressed data
      await writer.write(compressedData);
      await writer.close();
      
      // Read decompressed result
      const chunks: Uint8Array[] = [];
      let done = false;
      
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          chunks.push(value);
        }
      }
      
      // Combine chunks
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      
      return result;
    }
    
    // Fallback
    return compressedData;
  }

  /**
   * Aborts a stream operation
   */
  abortStream(streamId: string): boolean {
    const controller = this.activeStreams.get(streamId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(streamId);
      return true;
    }
    return false;
  }

  /**
   * Gets current memory usage statistics
   */
  getMemoryUsage(): {
    current: number;
    maximum: number;
    activeStreams: number;
    utilizationPercentage: number;
  } {
    return {
      current: this.memoryUsage,
      maximum: this.defaultOptions.maxMemoryUsage,
      activeStreams: this.activeStreams.size,
      utilizationPercentage: (this.memoryUsage / this.defaultOptions.maxMemoryUsage) * 100
    };
  }

  /**
   * Private helper methods
   */
  private async readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  private async createChecksumCalculator(): Promise<any> {
    // Use native crypto API if available
    if ('crypto' in window && 'subtle' in crypto) {
      return {
        data: new Uint8Array(),
        update: function(chunk: Uint8Array) {
          const newData = new Uint8Array(this.data.length + chunk.length);
          newData.set(this.data);
          newData.set(chunk, this.data.length);
          this.data = newData;
        },
        digest: async function(format: string): Promise<string> {
          const hashBuffer = await crypto.subtle.digest('SHA-256', this.data);
          const hashArray = new Uint8Array(hashBuffer);
          return Array.from(hashArray)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        }
      };
    }
    
    // Simple fallback checksum
    return {
      sum: 0,
      update: function(chunk: Uint8Array) {
        for (let i = 0; i < chunk.length; i++) {
          this.sum = (this.sum + chunk[i]) % 0xFFFFFFFF;
        }
      },
      digest: function(format: string): string {
        return this.sum.toString(16);
      }
    };
  }

  private async processDownloadedChunk(chunk: StreamChunk): Promise<void> {
    // This would typically save the chunk to a file or buffer
    // For now, we'll just log the progress
    this.logger.debug('Downloaded chunk', {
      component: 'StreamProcessor',
      offset: chunk.offset,
      size: chunk.size,
      isLast: chunk.isLast
    });
  }

  private async yieldControl(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  private async waitForMemoryAvailable(requiredMemory: number): Promise<void> {
    const maxWaitTime = 30000; // 30 seconds
    const checkInterval = 100; // 100ms
    let waited = 0;

    while (this.memoryUsage + requiredMemory > this.defaultOptions.maxMemoryUsage) {
      if (waited >= maxWaitTime) {
        throw new Error('Timeout waiting for memory to become available');
      }
      
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }
  }

  private setupMemoryMonitoring(): void {
    // Monitor memory usage and log warnings
    setInterval(() => {
      const usage = this.getMemoryUsage();
      if (usage.utilizationPercentage > 80) {
        this.logger.warn('High memory usage detected', {
          component: 'StreamProcessor',
          usage
        });
      }
    }, 5000); // Check every 5 seconds
  }

  private async getResumeOffset(identifier: string, url: string): Promise<number> {
    try {
      const key = `stream_resume_${btoa(identifier + url)}`;
      const stored = localStorage.getItem(key);
      return stored ? parseInt(stored, 10) : 0;
    } catch {
      return 0;
    }
  }

  private async saveResumeOffset(identifier: string, url: string, offset: number): Promise<void> {
    try {
      const key = `stream_resume_${btoa(identifier + url)}`;
      localStorage.setItem(key, offset.toString());
    } catch (error) {
      this.logger.warn('Failed to save resume offset', { error });
    }
  }

  private async clearResumeOffset(identifier: string, url: string): Promise<void> {
    try {
      const key = `stream_resume_${btoa(identifier + url)}`;
      localStorage.removeItem(key);
    } catch (error) {
      this.logger.warn('Failed to clear resume offset', { error });
    }
  }

  /**
   * Disposes the stream processor
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    // Abort all active streams
    for (const [streamId, controller] of this.activeStreams) {
      controller.abort();
    }
    
    this.activeStreams.clear();
    this.memoryUsage = 0;
    this.isDisposed = true;
  }
}