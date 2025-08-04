/**
 * GitHub API Service
 * 
 * Handles all GitHub API interactions with proper error handling,
 * rate limiting, caching, and security
 */

import { requestUrl } from 'obsidian';
import { DisposableService } from '../core/container';
import { SecureTokenManager, TokenValidationResult } from '../utils/secureStorage';
import { InputValidator } from '../utils/validation';

export interface GitHubFile {
  path: string;
  content: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
  lastModified?: Date;
  downloadUrl?: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: Date;
  };
  url: string;
}

export interface GitHubBranch {
  name: string;
  sha: string;
  isDefault: boolean;
  protected: boolean;
}

export interface GitHubRepository {
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  description?: string;
  url: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  used: number;
}

export interface GitHubApiOptions {
  retries?: number;
  timeout?: number;
  cacheTimeout?: number;
}

export class GitHubApiService extends DisposableService {
  private cache = new Map<string, { data: any; timestamp: number; ttl: number }>();
  private rateLimitInfo: RateLimitInfo | null = null;
  private requestQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;

  constructor(
    private tokenManager: SecureTokenManager,
    private options: GitHubApiOptions = {}
  ) {
    super();
    
    // Set default options
    this.options = {
      retries: 3,
      timeout: 30000,
      cacheTimeout: 5 * 60 * 1000, // 5 minutes
      ...options
    };
  }

  /**
   * Gets repository information
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    const cacheKey = `repo:${owner}/${repo}`;
    const cached = this.getCachedData(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await this.makeRequest(`/repos/${owner}/${repo}`);
    
    const repository: GitHubRepository = {
      owner: response.owner.login,
      name: response.name,
      fullName: response.full_name,
      isPrivate: response.private,
      defaultBranch: response.default_branch,
      description: response.description,
      url: response.html_url
    };

    this.setCachedData(cacheKey, repository);
    return repository;
  }

  /**
   * Gets a file from the repository
   */
  async getFile(owner: string, repo: string, path: string, branch: string = 'main'): Promise<GitHubFile> {
    const cacheKey = `file:${owner}/${repo}/${branch}/${path}`;
    const cached = this.getCachedData(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await this.makeRequest(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`
    );

    if (response.type !== 'file') {
      throw new Error(`Path ${path} is not a file`);
    }

    const file: GitHubFile = {
      path: response.path,
      content: atob(response.content.replace(/\s/g, '')), // Decode base64
      sha: response.sha,
      size: response.size,
      type: 'file',
      downloadUrl: response.download_url
    };

    this.setCachedData(cacheKey, file, this.options.cacheTimeout! / 2); // Shorter cache for files
    return file;
  }

  /**
   * Creates or updates a file in the repository
   */
  async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string = 'main',
    sha?: string
  ): Promise<GitHubCommit> {
    // Validate inputs
    const pathValidation = InputValidator.validateFilePath(path);
    if (!pathValidation.isValid) {
      throw new Error(`Invalid file path: ${pathValidation.errors.join(', ')}`);
    }

    const contentValidation = InputValidator.validateFileContent(content, path);
    if (!contentValidation.isValid) {
      throw new Error(`Invalid file content: ${contentValidation.errors.join(', ')}`);
    }

    const body: any = {
      message,
      content: btoa(content), // Encode to base64
      branch
    };

    if (sha) {
      body.sha = sha;
    }

    const response = await this.makeRequest(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
      {
        method: 'PUT',
        body: JSON.stringify(body)
      }
    );

    // Clear related cache entries
    this.clearCacheByPattern(`file:${owner}/${repo}/${branch}/`);

    return {
      sha: response.commit.sha,
      message: response.commit.message,
      author: {
        name: response.commit.author.name,
        email: response.commit.author.email,
        date: new Date(response.commit.author.date)
      },
      url: response.commit.html_url
    };
  }

  /**
   * Deletes a file from the repository
   */
  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    message: string,
    sha: string,
    branch: string = 'main'
  ): Promise<GitHubCommit> {
    const body = {
      message,
      sha,
      branch
    };

    const response = await this.makeRequest(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
      {
        method: 'DELETE',
        body: JSON.stringify(body)
      }
    );

    // Clear related cache entries
    this.clearCacheByPattern(`file:${owner}/${repo}/${branch}/`);

    return {
      sha: response.commit.sha,
      message: response.commit.message,
      author: {
        name: response.commit.author.name,
        email: response.commit.author.email,
        date: new Date(response.commit.author.date)
      },
      url: response.commit.html_url
    };
  }

  /**
   * Lists files in a directory
   */
  async listFiles(
    owner: string,
    repo: string,
    path: string = '',
    branch: string = 'main'
  ): Promise<GitHubFile[]> {
    const cacheKey = `list:${owner}/${repo}/${branch}/${path}`;
    const cached = this.getCachedData(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await this.makeRequest(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`
    );

    if (!Array.isArray(response)) {
      throw new Error(`Path ${path} is not a directory`);
    }

    const files: GitHubFile[] = response.map(item => ({
      path: item.path,
      content: '', // Content not loaded for listings
      sha: item.sha,
      size: item.size || 0,
      type: item.type as 'file' | 'dir',
      downloadUrl: item.download_url
    }));

    this.setCachedData(cacheKey, files);
    return files;
  }

  /**
   * Gets repository branches
   */
  async getBranches(owner: string, repo: string): Promise<GitHubBranch[]> {
    const cacheKey = `branches:${owner}/${repo}`;
    const cached = this.getCachedData(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await this.makeRequest(`/repos/${owner}/${repo}/branches`);
    
    const branches: GitHubBranch[] = response.map((branch: any) => ({
      name: branch.name,
      sha: branch.commit.sha,
      isDefault: false, // Will be updated with repo info
      protected: branch.protected || false
    }));

    // Get default branch info
    try {
      const repoInfo = await this.getRepository(owner, repo);
      branches.forEach(branch => {
        branch.isDefault = branch.name === repoInfo.defaultBranch;
      });
    } catch (error) {
      console.warn('Could not get default branch info:', error);
    }

    this.setCachedData(cacheKey, branches, this.options.cacheTimeout! * 2); // Longer cache for branches
    return branches;
  }

  /**
   * Gets commit history for a file or repository
   */
  async getCommits(
    owner: string,
    repo: string,
    options: {
      path?: string;
      branch?: string;
      limit?: number;
      since?: Date;
    } = {}
  ): Promise<GitHubCommit[]> {
    const { path, branch = 'main', limit = 10, since } = options;
    
    let url = `/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${limit}`;
    
    if (path) {
      url += `&path=${encodeURIComponent(path)}`;
    }
    
    if (since) {
      url += `&since=${since.toISOString()}`;
    }

    const response = await this.makeRequest(url);
    
    return response.map((commit: any) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        name: commit.commit.author.name,
        email: commit.commit.author.email,
        date: new Date(commit.commit.author.date)
      },
      url: commit.html_url
    }));
  }

  /**
   * Validates the current token
   */
  async validateToken(): Promise<TokenValidationResult> {
    return this.tokenManager.validateToken();
  }

  /**
   * Gets current rate limit information
   */
  async getRateLimit(): Promise<RateLimitInfo> {
    const response = await this.makeRequest('/rate_limit');
    
    this.rateLimitInfo = {
      limit: response.rate.limit,
      remaining: response.rate.remaining,
      reset: new Date(response.rate.reset * 1000),
      used: response.rate.limit - response.rate.remaining
    };

    return this.rateLimitInfo;
  }

  /**
   * Batch operations for multiple files
   */
  async batchGetFiles(
    owner: string,
    repo: string,
    paths: string[],
    branch: string = 'main'
  ): Promise<GitHubFile[]> {
    const results: GitHubFile[] = [];
    const batchSize = 10; // Respect rate limits
    
    for (let i = 0; i < paths.length; i += batchSize) {
      const batch = paths.slice(i, i + batchSize);
      const batchPromises = batch.map(path => 
        this.getFile(owner, repo, path, branch).catch(error => {
          console.warn(`Failed to get file ${path}:`, error);
          return null;
        })
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(result => result !== null) as GitHubFile[]);
      
      // Small delay between batches to respect rate limits
      if (i + batchSize < paths.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }

  /**
   * Makes an authenticated request to the GitHub API
   */
  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    this.checkDisposed();
    
    // Check rate limits
    if (this.rateLimitInfo && this.rateLimitInfo.remaining < 10) {
      const resetTime = this.rateLimitInfo.reset.getTime() - Date.now();
      if (resetTime > 0) {
        throw new Error(`Rate limit exceeded. Resets in ${Math.ceil(resetTime / 1000)}s`);
      }
    }

    const token = await this.tokenManager.getToken();
    if (!token) {
      throw new Error('GitHub token not configured');
    }

    const url = `https://api.github.com${endpoint}`;
    const headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Obsidian-Mobile-Git-Sync',
      'Content-Type': 'application/json',
      ...options.headers
    };

    let lastError: Error;
    const maxRetries = this.options.retries || 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await requestUrl({
          url,
          method: options.method || 'GET',
          headers,
          body: options.body,
          throw: false
        });

        // Update rate limit info from headers
        this.updateRateLimitFromHeaders(response.headers);

        if (response.status >= 200 && response.status < 300) {
          return response.json;
        }

        // Handle specific error codes
        if (response.status === 401) {
          throw new Error('GitHub token is invalid or expired');
        } else if (response.status === 403) {
          if (response.headers['x-ratelimit-remaining'] === '0') {
            throw new Error('GitHub rate limit exceeded');
          }
          throw new Error('GitHub API access forbidden - check token permissions');
        } else if (response.status === 404) {
          throw new Error('GitHub resource not found - check repository and path');
        } else if (response.status >= 500) {
          throw new Error('GitHub API server error - try again later');
        }

        throw new Error(`GitHub API error: ${response.status} ${response.text}`);

      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries - 1) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`GitHub API request failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Updates rate limit info from response headers
   */
  private updateRateLimitFromHeaders(headers: Record<string, string>): void {
    const limit = parseInt(headers['x-ratelimit-limit']);
    const remaining = parseInt(headers['x-ratelimit-remaining']);
    const reset = parseInt(headers['x-ratelimit-reset']);

    if (!isNaN(limit) && !isNaN(remaining) && !isNaN(reset)) {
      this.rateLimitInfo = {
        limit,
        remaining,
        reset: new Date(reset * 1000),
        used: limit - remaining
      };
    }
  }

  /**
   * Gets cached data if still valid
   */
  private getCachedData(key: string): any | null {
    const cached = this.cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data;
    }
    
    if (cached) {
      this.cache.delete(key);
    }
    
    return null;
  }

  /**
   * Sets cached data with TTL
   */
  private setCachedData(key: string, data: any, ttl: number = this.options.cacheTimeout!): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  /**
   * Clears cache entries matching a pattern
   */
  private clearCacheByPattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clears all cached data
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Gets cache statistics
   */
  getCacheStats(): { size: number; entries: Array<{ key: string; age: number; size: number }> } {
    const entries = Array.from(this.cache.entries()).map(([key, value]) => ({
      key,
      age: Date.now() - value.timestamp,
      size: JSON.stringify(value.data).length
    }));

    return {
      size: this.cache.size,
      entries
    };
  }

  /**
   * Disposes the service and clears resources
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.cache.clear();
    this.rateLimitInfo = null;
    this.requestQueue = [];
    this.isDisposed = true;
  }
}