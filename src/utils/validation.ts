/**
 * Input Validation and Sanitization System
 * 
 * Provides comprehensive validation for user inputs, API responses,
 * and file operations to prevent security issues and data corruption
 */

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedValue?: any;
}

export interface ValidationRule<T = any> {
  name: string;
  validate: (value: T) => boolean | string;
  required?: boolean;
  sanitize?: (value: T) => T;
}

export class InputValidator {
  private static readonly GITHUB_URL_PATTERN = /^https:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:\.git)?$/;
  private static readonly GITHUB_TOKEN_PATTERNS = [
    /^ghp_[a-zA-Z0-9]{36}$/, // Classic personal access tokens
    /^github_pat_[a-zA-Z0-9_]{82}$/ // Fine-grained personal access tokens
  ];
  private static readonly BRANCH_NAME_PATTERN = /^[a-zA-Z0-9_.-\/]+$/;
  private static readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  private static readonly DANGEROUS_PATTERNS = [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /data:text\/html/gi,
    /vbscript:/gi,
    /onload=/gi,
    /onerror=/gi
  ];

  /**
   * Validates GitHub repository URL
   */
  static validateRepositoryUrl(url: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let sanitizedValue = url;

    if (!url || typeof url !== 'string') {
      errors.push('Repository URL is required');
      return { isValid: false, errors, warnings };
    }

    // Sanitize URL
    sanitizedValue = url.trim();
    
    // Remove .git suffix if present
    if (sanitizedValue.endsWith('.git')) {
      sanitizedValue = sanitizedValue.slice(0, -4);
    }

    // Validate format
    if (!this.GITHUB_URL_PATTERN.test(sanitizedValue)) {
      errors.push('Invalid GitHub repository URL format. Expected: https://github.com/owner/repo');
    }

    // Check for suspicious patterns
    if (sanitizedValue.includes('..')) {
      errors.push('Repository URL contains invalid path traversal sequences');
    }

    // Extract and validate owner/repo names
    const match = sanitizedValue.match(this.GITHUB_URL_PATTERN);
    if (match) {
      const [, owner, repo] = match;
      
      if (owner.length < 1 || owner.length > 39) {
        errors.push('Repository owner name must be 1-39 characters');
      }
      
      if (repo.length < 1 || repo.length > 100) {
        errors.push('Repository name must be 1-100 characters');
      }

      // Check for reserved names
      const reservedNames = ['admin', 'api', 'www', 'github', 'support'];
      if (reservedNames.includes(owner.toLowerCase())) {
        warnings.push('Repository owner uses a reserved name');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedValue
    };
  }

  /**
   * Validates GitHub personal access token
   */
  static validateGitHubToken(token: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let sanitizedValue = token;

    if (!token || typeof token !== 'string') {
      errors.push('GitHub token is required');
      return { isValid: false, errors, warnings };
    }

    // Sanitize token (trim whitespace)
    sanitizedValue = token.trim();

    // Check format
    const isValidFormat = this.GITHUB_TOKEN_PATTERNS.some(pattern => 
      pattern.test(sanitizedValue)
    );

    if (!isValidFormat) {
      errors.push('Invalid GitHub token format. Expected ghp_... or github_pat_...');
    }

    // Check for common mistakes
    if (sanitizedValue.includes(' ')) {
      errors.push('GitHub token should not contain spaces');
    }

    if (sanitizedValue.length < 20) {
      errors.push('GitHub token appears to be too short');
    }

    if (sanitizedValue.length > 255) {
      errors.push('GitHub token appears to be too long');
    }

    // Security checks
    if (sanitizedValue === token && token.length > 0) {
      // Don't log the actual token, just validate structure
      if (sanitizedValue.startsWith('gho_') || sanitizedValue.startsWith('ghu_')) {
        warnings.push('OAuth app tokens may not work with this plugin');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedValue
    };
  }

  /**
   * Validates Git branch name
   */
  static validateBranchName(branch: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let sanitizedValue = branch;

    if (!branch || typeof branch !== 'string') {
      errors.push('Branch name is required');
      return { isValid: false, errors, warnings };
    }

    // Sanitize branch name
    sanitizedValue = branch.trim();

    // Basic format validation
    if (!this.BRANCH_NAME_PATTERN.test(sanitizedValue)) {
      errors.push('Branch name contains invalid characters');
    }

    // Git branch name rules
    if (sanitizedValue.startsWith('.') || sanitizedValue.startsWith('-')) {
      errors.push('Branch name cannot start with . or -');
    }

    if (sanitizedValue.endsWith('.') || sanitizedValue.endsWith('/')) {
      errors.push('Branch name cannot end with . or /');
    }

    if (sanitizedValue.includes('..')) {
      errors.push('Branch name cannot contain consecutive dots');
    }

    if (sanitizedValue.includes('//')) {
      errors.push('Branch name cannot contain consecutive slashes');
    }

    if (sanitizedValue.length > 250) {
      errors.push('Branch name is too long (max 250 characters)');
    }

    // Common branch names
    const commonBranches = ['main', 'master', 'develop', 'dev'];
    if (!commonBranches.includes(sanitizedValue) && !sanitizedValue.includes('/')) {
      warnings.push('Consider using standard branch naming conventions');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedValue
    };
  }

  /**
   * Validates file path for security and correctness
   */
  static validateFilePath(filePath: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let sanitizedValue = filePath;

    if (!filePath || typeof filePath !== 'string') {
      errors.push('File path is required');
      return { isValid: false, errors, warnings };
    }

    // Sanitize path
    sanitizedValue = filePath.trim().replace(/\\/g, '/'); // Normalize separators

    // Security checks
    if (sanitizedValue.includes('..')) {
      errors.push('File path contains path traversal sequences');
    }

    if (sanitizedValue.startsWith('/') || sanitizedValue.includes('://')) {
      errors.push('File path should be relative to vault root');
    }

    // Length validation
    if (sanitizedValue.length > 260) {
      errors.push('File path is too long (max 260 characters)');
    }

    // Character validation
    const invalidChars = /[<>:"|?*\x00-\x1f]/;
    if (invalidChars.test(sanitizedValue)) {
      errors.push('File path contains invalid characters');
    }

    // Extension validation
    const allowedExtensions = ['.md', '.txt', '.json', '.csv', '.pdf', '.png', '.jpg', '.jpeg', '.gif'];
    const extension = sanitizedValue.toLowerCase().substring(sanitizedValue.lastIndexOf('.'));
    
    if (extension && !allowedExtensions.includes(extension)) {
      warnings.push(`File extension '${extension}' may not be supported`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedValue
    };
  }

  /**
   * Validates and sanitizes file content
   */
  static validateFileContent(content: string, filePath?: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let sanitizedValue = content;

    if (typeof content !== 'string') {
      errors.push('File content must be a string');
      return { isValid: false, errors, warnings };
    }

    // Size validation
    const contentSize = new Blob([content]).size;
    if (contentSize > this.MAX_FILE_SIZE) {
      errors.push(`File is too large (${Math.round(contentSize / 1024 / 1024)}MB, max ${this.MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    // Security scanning for potentially dangerous content
    this.DANGEROUS_PATTERNS.forEach(pattern => {
      if (pattern.test(content)) {
        warnings.push('File content contains potentially unsafe elements');
      }
    });

    // Markdown-specific validation
    if (filePath && filePath.endsWith('.md')) {
      // Check for excessively long lines
      const lines = content.split('\n');
      const longLines = lines.filter(line => line.length > 1000);
      if (longLines.length > 0) {
        warnings.push(`${longLines.length} lines are extremely long and may cause performance issues`);
      }

      // Check for suspicious links
      const linkPattern = /\[.*?\]\((.*?)\)/g;
      let match;
      while ((match = linkPattern.exec(content)) !== null) {
        const url = match[1];
        if (url.startsWith('javascript:') || url.startsWith('data:')) {
          warnings.push('Content contains potentially unsafe links');
          break;
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedValue
    };
  }

  /**
   * Validates API response structure
   */
  static validateGitHubApiResponse(response: any, expectedStructure: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!response || typeof response !== 'object') {
      errors.push('Invalid API response: not an object');
      return { isValid: false, errors, warnings };
    }

    // Check for error responses
    if (response.message && response.documentation_url) {
      errors.push(`GitHub API error: ${response.message}`);
    }

    // Validate expected fields exist
    const validateStructure = (obj: any, expected: any, path = ''): void => {
      for (const key in expected) {
        const fullPath = path ? `${path}.${key}` : key;
        
        if (!(key in obj)) {
          if (expected[key].required !== false) {
            errors.push(`Missing required field: ${fullPath}`);
          }
          continue;
        }

        const expectedType = expected[key].type || expected[key];
        const actualValue = obj[key];

        if (expectedType === 'string' && typeof actualValue !== 'string') {
          errors.push(`Field ${fullPath} should be string, got ${typeof actualValue}`);
        } else if (expectedType === 'number' && typeof actualValue !== 'number') {
          errors.push(`Field ${fullPath} should be number, got ${typeof actualValue}`);
        } else if (expectedType === 'boolean' && typeof actualValue !== 'boolean') {
          errors.push(`Field ${fullPath} should be boolean, got ${typeof actualValue}`);
        } else if (typeof expectedType === 'object' && typeof actualValue === 'object') {
          validateStructure(actualValue, expectedType, fullPath);
        }
      }
    };

    if (expectedStructure) {
      validateStructure(response, expectedStructure);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedValue: response
    };
  }

  /**
   * Validates exclude patterns for file sync
   */
  static validateExcludePatterns(patterns: string[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sanitizedValue: string[] = [];

    if (!Array.isArray(patterns)) {
      errors.push('Exclude patterns must be an array');
      return { isValid: false, errors, warnings };
    }

    patterns.forEach((pattern, index) => {
      if (typeof pattern !== 'string') {
        errors.push(`Pattern at index ${index} must be a string`);
        return;
      }

      const trimmedPattern = pattern.trim();
      if (trimmedPattern.length === 0) {
        warnings.push(`Empty pattern at index ${index} will be ignored`);
        return;
      }

      // Validate glob pattern syntax
      try {
        // Basic validation - more sophisticated glob validation could be added
        if (trimmedPattern.includes('***')) {
          warnings.push(`Pattern "${trimmedPattern}" contains unusual glob syntax`);
        }

        if (trimmedPattern.startsWith('/') || trimmedPattern.includes('://')) {
          warnings.push(`Pattern "${trimmedPattern}" should be relative to vault root`);
        }

        sanitizedValue.push(trimmedPattern);
      } catch (error) {
        errors.push(`Invalid pattern "${trimmedPattern}": ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedValue
    };
  }

  /**
   * Comprehensive settings validation
   */
  static validateSettings(settings: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sanitizedValue: any = {};

    // Validate repository URL
    const urlResult = this.validateRepositoryUrl(settings.repoUrl);
    if (!urlResult.isValid) {
      errors.push(...urlResult.errors);
    } else {
      sanitizedValue.repoUrl = urlResult.sanitizedValue;
    }
    warnings.push(...urlResult.warnings);

    // Validate GitHub token
    const tokenResult = this.validateGitHubToken(settings.githubToken);
    if (!tokenResult.isValid) {
      errors.push(...tokenResult.errors);
    } else {
      sanitizedValue.githubToken = tokenResult.sanitizedValue;
    }
    warnings.push(...tokenResult.warnings);

    // Validate branch
    const branchResult = this.validateBranchName(settings.branch);
    if (!branchResult.isValid) {
      errors.push(...branchResult.errors);
    } else {
      sanitizedValue.branch = branchResult.sanitizedValue;
    }
    warnings.push(...branchResult.warnings);

    // Validate exclude patterns
    const patternsResult = this.validateExcludePatterns(settings.excludePatterns || []);
    if (!patternsResult.isValid) {
      errors.push(...patternsResult.errors);
    } else {
      sanitizedValue.excludePatterns = patternsResult.sanitizedValue;
    }
    warnings.push(...patternsResult.warnings);

    // Validate other settings
    if (settings.autoSyncInterval !== undefined) {
      const interval = Number(settings.autoSyncInterval);
      if (isNaN(interval) || interval < 60000) { // Minimum 1 minute
        errors.push('Auto-sync interval must be at least 60 seconds');
      } else if (interval > 24 * 60 * 60 * 1000) { // Maximum 24 hours
        warnings.push('Auto-sync interval is very long (over 24 hours)');
        sanitizedValue.autoSyncInterval = interval;
      } else {
        sanitizedValue.autoSyncInterval = interval;
      }
    }

    // Copy other valid settings
    const validKeys = ['syncFolders', 'useGitHubAPI', 'isConfigured', 'conflictStrategy'];
    validKeys.forEach(key => {
      if (settings[key] !== undefined) {
        sanitizedValue[key] = settings[key];
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedValue
    };
  }
}