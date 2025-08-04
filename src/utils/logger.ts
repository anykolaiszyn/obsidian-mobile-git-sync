/**
 * Structured Logging System
 * 
 * Provides comprehensive logging with levels, contexts, formatting,
 * and structured data for debugging and monitoring
 */

import { DisposableService } from '../core/container';
import { LogLevel, LogEntry } from '../types';

export interface LogContext {
  component?: string;
  operation?: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  correlationId?: string;
  metadata?: Record<string, any>;
}

export interface LoggerConfig {
  level: LogLevel;
  maxEntries: number;
  enableConsole: boolean;
  enableStorage: boolean;
  enableRemoteLogging: boolean;
  contextualDefaults: LogContext;
  formatters: {
    console: (entry: LogEntry) => string;
    storage: (entry: LogEntry) => string;
  };
}

export interface LogMetrics {
  totalLogs: number;
  logsByLevel: Record<LogLevel, number>;
  errorRate: number;
  averageLogSize: number;
  recentErrors: LogEntry[];
  performanceMetrics: {
    logProcessingTime: number;
    storageSize: number;
    memoryUsage: number;
  };
}

export interface LogQuery {
  level?: LogLevel | LogLevel[];
  component?: string;
  operation?: string;
  timeRange?: {
    start: Date;
    end: Date;
  };
  contains?: string;
  limit?: number;
  offset?: number;
}

export class Logger extends DisposableService {
  private logs: LogEntry[] = [];
  private config: LoggerConfig;
  private sessionId: string;
  private metricsCache: LogMetrics | null = null;
  private metricsCacheExpiry: number = 0;

  constructor(config: Partial<LoggerConfig> = {}) {
    super();
    
    this.sessionId = this.generateSessionId();
    this.config = {
      level: 'info',
      maxEntries: 1000,
      enableConsole: true,
      enableStorage: false,
      enableRemoteLogging: false,
      contextualDefaults: {
        sessionId: this.sessionId
      },
      formatters: {
        console: this.defaultConsoleFormatter,
        storage: this.defaultStorageFormatter
      },
      ...config
    };

    this.info('Logger initialized', { config: this.sanitizeConfig(this.config) });
  }

  /**
   * Logs a debug message
   */
  debug(message: string, data?: any, context?: LogContext): void {
    this.log('debug', message, data, context);
  }

  /**
   * Logs an info message
   */
  info(message: string, data?: any, context?: LogContext): void {
    this.log('info', message, data, context);
  }

  /**
   * Logs a warning message
   */
  warn(message: string, data?: any, context?: LogContext): void {
    this.log('warn', message, data, context);
  }

  /**
   * Logs an error message
   */
  error(message: string, data?: any, context?: LogContext): void {
    this.log('error', message, data, context);
  }

  /**
   * Logs a success message
   */
  success(message: string, data?: any, context?: LogContext): void {
    this.log('success', message, data, context);
  }

  /**
   * Core logging method
   */
  log(level: LogLevel, message: string, data?: any, context?: LogContext): void {
    this.checkDisposed();

    // Check if this level should be logged
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      data: this.sanitizeData(data),
      context: this.mergeContext(context)
    };

    // Add to internal log store
    this.addLogEntry(entry);

    // Output to console if enabled
    if (this.config.enableConsole) {
      this.logToConsole(entry);
    }

    // Store persistently if enabled
    if (this.config.enableStorage) {
      this.logToStorage(entry);
    }

    // Send to remote logging if enabled
    if (this.config.enableRemoteLogging) {
      this.logToRemote(entry);
    }

    // Clear metrics cache
    this.invalidateMetricsCache();
  }

  /**
   * Creates a child logger with additional context
   */
  child(context: LogContext): Logger {
    const childConfig = {
      ...this.config,
      contextualDefaults: {
        ...this.config.contextualDefaults,
        ...context
      }
    };

    return new Logger(childConfig);
  }

  /**
   * Measures execution time of a function
   */
  async time<T>(
    operation: string, 
    fn: () => Promise<T> | T, 
    context?: LogContext
  ): Promise<T> {
    const startTime = Date.now();
    const operationContext = { ...context, operation };

    this.debug(`Starting ${operation}`, undefined, operationContext);

    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      
      this.success(`Completed ${operation}`, { duration }, operationContext);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.error(`Failed ${operation}`, { 
        error: error instanceof Error ? error.message : String(error),
        duration 
      }, operationContext);
      
      throw error;
    }
  }

  /**
   * Creates a performance timer
   */
  startTimer(name: string, context?: LogContext): () => void {
    const startTime = Date.now();
    const timerContext = { ...context, operation: name };

    this.debug(`Timer started: ${name}`, undefined, timerContext);

    return () => {
      const duration = Date.now() - startTime;
      this.info(`Timer finished: ${name}`, { duration }, timerContext);
    };
  }

  /**
   * Queries logs based on criteria
   */
  query(query: LogQuery = {}): LogEntry[] {
    let results = [...this.logs];

    // Filter by level
    if (query.level) {
      const levels = Array.isArray(query.level) ? query.level : [query.level];
      results = results.filter(entry => levels.includes(entry.level));
    }

    // Filter by component
    if (query.component) {
      results = results.filter(entry => 
        entry.context?.component === query.component
      );
    }

    // Filter by operation
    if (query.operation) {
      results = results.filter(entry => 
        entry.context?.operation === query.operation
      );
    }

    // Filter by time range
    if (query.timeRange) {
      const { start, end } = query.timeRange;
      results = results.filter(entry => 
        entry.timestamp >= start.getTime() && entry.timestamp <= end.getTime()
      );
    }

    // Filter by content
    if (query.contains) {
      const searchTerm = query.contains.toLowerCase();
      results = results.filter(entry => 
        entry.message.toLowerCase().includes(searchTerm) ||
        JSON.stringify(entry.data).toLowerCase().includes(searchTerm)
      );
    }

    // Apply pagination
    const offset = query.offset || 0;
    const limit = query.limit || results.length;
    
    return results.slice(offset, offset + limit);
  }

  /**
   * Gets comprehensive logging metrics
   */
  getMetrics(): LogMetrics {
    // Return cached metrics if still valid
    if (this.metricsCache && Date.now() < this.metricsCacheExpiry) {
      return this.metricsCache;
    }

    const totalLogs = this.logs.length;
    const logsByLevel: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      success: 0
    };

    let totalLogSize = 0;
    const recentErrors: LogEntry[] = [];

    // Calculate metrics
    this.logs.forEach(entry => {
      logsByLevel[entry.level]++;
      totalLogSize += JSON.stringify(entry).length;

      // Collect recent errors (last 24 hours)
      if (entry.level === 'error' && Date.now() - entry.timestamp < 24 * 60 * 60 * 1000) {
        recentErrors.push(entry);
      }
    });

    const errorRate = totalLogs > 0 ? logsByLevel.error / totalLogs : 0;
    const averageLogSize = totalLogs > 0 ? totalLogSize / totalLogs : 0;

    this.metricsCache = {
      totalLogs,
      logsByLevel,
      errorRate,
      averageLogSize,
      recentErrors: recentErrors.slice(-10), // Last 10 errors
      performanceMetrics: {
        logProcessingTime: 0, // Would be measured in production
        storageSize: totalLogSize,
        memoryUsage: this.estimateMemoryUsage()
      }
    };

    // Cache for 5 minutes
    this.metricsCacheExpiry = Date.now() + 5 * 60 * 1000;
    
    return this.metricsCache;
  }

  /**
   * Exports logs in various formats
   */
  export(format: 'json' | 'csv' | 'text' = 'json', query?: LogQuery): string {
    const logs = query ? this.query(query) : this.logs;

    switch (format) {
      case 'json':
        return JSON.stringify(logs, null, 2);

      case 'csv':
        return this.exportToCSV(logs);

      case 'text':
        return this.exportToText(logs);

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Clears all logs
   */
  clear(): void {
    this.logs = [];
    this.invalidateMetricsCache();
    this.info('Logs cleared');
  }

  /**
   * Updates logger configuration
   */
  updateConfig(newConfig: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.info('Logger configuration updated', { config: this.sanitizeConfig(newConfig) });
  }

  /**
   * Checks if a log level should be processed
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'success'];
    const currentLevelIndex = levels.indexOf(this.config.level);
    const logLevelIndex = levels.indexOf(level);

    // Always log errors and success, otherwise check level hierarchy
    return level === 'error' || level === 'success' || logLevelIndex >= currentLevelIndex;
  }

  /**
   * Adds a log entry to the internal store
   */
  private addLogEntry(entry: LogEntry): void {
    this.logs.push(entry);

    // Trim logs if exceeding max entries
    if (this.logs.length > this.config.maxEntries) {
      const removeCount = this.logs.length - this.config.maxEntries;
      this.logs.splice(0, removeCount);
    }
  }

  /**
   * Logs to console with appropriate formatting
   */
  private logToConsole(entry: LogEntry): void {
    const formatted = this.config.formatters.console(entry);
    
    switch (entry.level) {
      case 'debug':
        console.debug(formatted);
        break;
      case 'info':
        console.info(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
      case 'success':
        console.log(formatted);
        break;
    }
  }

  /**
   * Logs to persistent storage
   */
  private async logToStorage(entry: LogEntry): Promise<void> {
    try {
      // In a real implementation, this would write to file system or database
      const formatted = this.config.formatters.storage(entry);
      // Store the formatted log entry
    } catch (error) {
      console.error('Failed to write log to storage:', error);
    }
  }

  /**
   * Logs to remote logging service
   */
  private async logToRemote(entry: LogEntry): Promise<void> {
    try {
      // In a real implementation, this would send to a logging service
      // await this.remoteLoggingService.send(entry);
    } catch (error) {
      console.error('Failed to send log to remote service:', error);
    }
  }

  /**
   * Merges context with defaults
   */
  private mergeContext(context?: LogContext): LogContext {
    return {
      ...this.config.contextualDefaults,
      ...context
    };
  }

  /**
   * Sanitizes data to prevent logging sensitive information
   */
  private sanitizeData(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    // Clone to avoid modifying original
    const sanitized = JSON.parse(JSON.stringify(data));

    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'credential'];
    
    const sanitizeObject = (obj: any): void => {
      if (typeof obj !== 'object' || obj === null) {
        return;
      }

      for (const key in obj) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          sanitizeObject(obj[key]);
        }
      }
    };

    sanitizeObject(sanitized);
    return sanitized;
  }

  /**
   * Default console formatter
   */
  private defaultConsoleFormatter = (entry: LogEntry): string => {
    const timestamp = new Date(entry.timestamp).toISOString();
    const level = entry.level.toUpperCase().padEnd(7);
    const component = entry.context?.component ? `[${entry.context.component}] ` : '';
    const operation = entry.context?.operation ? `(${entry.context.operation}) ` : '';
    
    let formatted = `${timestamp} ${level} ${component}${operation}${entry.message}`;
    
    if (entry.data) {
      formatted += `\n  Data: ${JSON.stringify(entry.data, null, 2)}`;
    }

    return formatted;
  };

  /**
   * Default storage formatter
   */
  private defaultStorageFormatter = (entry: LogEntry): string => {
    return JSON.stringify(entry);
  };

  /**
   * Exports logs to CSV format
   */
  private exportToCSV(logs: LogEntry[]): string {
    const headers = ['timestamp', 'level', 'message', 'component', 'operation', 'data'];
    const rows = logs.map(entry => [
      new Date(entry.timestamp).toISOString(),
      entry.level,
      entry.message.replace(/"/g, '""'), // Escape quotes
      entry.context?.component || '',
      entry.context?.operation || '',
      entry.data ? JSON.stringify(entry.data).replace(/"/g, '""') : ''
    ]);

    return [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
  }

  /**
   * Exports logs to plain text format
   */
  private exportToText(logs: LogEntry[]): string {
    return logs.map(entry => this.config.formatters.console(entry)).join('\n');
  }

  /**
   * Estimates memory usage of stored logs
   */
  private estimateMemoryUsage(): number {
    return JSON.stringify(this.logs).length * 2; // Rough estimate (UTF-16)
  }

  /**
   * Sanitizes config for logging (removes sensitive data)
   */
  private sanitizeConfig(config: any): any {
    const { contextualDefaults, ...sanitized } = config;
    return sanitized;
  }

  /**
   * Generates a unique session ID
   */
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Invalidates the metrics cache
   */
  private invalidateMetricsCache(): void {
    this.metricsCache = null;
    this.metricsCacheExpiry = 0;
  }

  /**
   * Disposes the logger
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.info('Logger disposing');
    this.logs = [];
    this.metricsCache = null;
    this.isDisposed = true;
  }
}