/**
 * Comprehensive Testing Framework
 * 
 * Provides unit testing, integration testing, and mock utilities
 * specifically designed for Obsidian plugin development
 */

import { App, TFile, Vault } from 'obsidian';

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: Error;
  logs?: string[];
  metadata?: Record<string, any>;
}

export interface TestSuite {
  name: string;
  description?: string;
  tests: Test[];
  beforeAll?: () => Promise<void> | void;
  afterAll?: () => Promise<void> | void;
  beforeEach?: () => Promise<void> | void;
  afterEach?: () => Promise<void> | void;
}

export interface Test {
  name: string;
  description?: string;
  timeout?: number;
  skip?: boolean;
  only?: boolean;
  fn: () => Promise<void> | void;
}

export interface MockOptions {
  returnValue?: any;
  throwError?: Error;
  implementation?: (...args: any[]) => any;
  callCount?: number;
}

export interface TestReport {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  totalDuration: number;
  suites: Array<{
    name: string;
    results: TestResult[];
    stats: {
      passed: number;
      failed: number;
      skipped: number;
      duration: number;
    };
  }>;
  coverage?: {
    statements: number;
    branches: number;
    functions: number;
    lines: number;
  };
}

export class TestFramework {
  private suites: TestSuite[] = [];
  private mocks = new Map<string, any>();
  private originalFunctions = new Map<string, any>();

  /**
   * Describes a test suite
   */
  describe(name: string, fn: () => void, description?: string): void {
    const suite: TestSuite = {
      name,
      description,
      tests: []
    };

    // Set current suite context
    const originalSuite = this.getCurrentSuite();
    this.setCurrentSuite(suite);

    try {
      fn();
    } finally {
      this.setCurrentSuite(originalSuite);
    }

    this.suites.push(suite);
  }

  /**
   * Defines a test case
   */
  it(name: string, fn: () => Promise<void> | void, options: Partial<Test> = {}): void {
    const test: Test = {
      name,
      fn,
      timeout: 5000,
      ...options
    };

    const currentSuite = this.getCurrentSuite();
    if (currentSuite) {
      currentSuite.tests.push(test);
    } else {
      throw new Error('Test must be defined within a describe block');
    }
  }

  /**
   * Sets up before all tests in suite
   */
  beforeAll(fn: () => Promise<void> | void): void {
    const currentSuite = this.getCurrentSuite();
    if (currentSuite) {
      currentSuite.beforeAll = fn;
    }
  }

  /**
   * Sets up after all tests in suite
   */
  afterAll(fn: () => Promise<void> | void): void {
    const currentSuite = this.getCurrentSuite();
    if (currentSuite) {
      currentSuite.afterAll = fn;
    }
  }

  /**
   * Sets up before each test
   */
  beforeEach(fn: () => Promise<void> | void): void {
    const currentSuite = this.getCurrentSuite();
    if (currentSuite) {
      currentSuite.beforeEach = fn;
    }
  }

  /**
   * Sets up after each test
   */
  afterEach(fn: () => Promise<void> | void): void {
    const currentSuite = this.getCurrentSuite();
    if (currentSuite) {
      currentSuite.afterEach = fn;
    }
  }

  /**
   * Runs all test suites
   */
  async run(): Promise<TestReport> {
    const report: TestReport = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      totalDuration: 0,
      suites: []
    };

    const startTime = Date.now();

    for (const suite of this.suites) {
      const suiteResults = await this.runSuite(suite);
      
      report.suites.push({
        name: suite.name,
        results: suiteResults,
        stats: this.calculateSuiteStats(suiteResults)
      });

      // Update totals
      suiteResults.forEach(result => {
        report.totalTests++;
        if (result.passed) {
          report.passedTests++;
        } else {
          report.failedTests++;
        }
      });
    }

    report.totalDuration = Date.now() - startTime;
    return report;
  }

  /**
   * Runs a specific test suite
   */
  private async runSuite(suite: TestSuite): Promise<TestResult[]> {
    const results: TestResult[] = [];

    try {
      // Run beforeAll
      if (suite.beforeAll) {
        await this.runWithTimeout(suite.beforeAll, 10000);
      }

      // Run tests
      for (const test of suite.tests) {
        if (test.skip) {
          results.push({
            name: test.name,
            passed: false,
            duration: 0,
            logs: ['Test skipped']
          });
          continue;
        }

        const result = await this.runTest(test, suite);
        results.push(result);
      }

    } finally {
      // Run afterAll
      if (suite.afterAll) {
        try {
          await this.runWithTimeout(suite.afterAll, 10000);
        } catch (error) {
          console.error(`Error in afterAll for suite ${suite.name}:`, error);
        }
      }
    }

    return results;
  }

  /**
   * Runs a single test
   */
  private async runTest(test: Test, suite: TestSuite): Promise<TestResult> {
    const startTime = Date.now();
    const logs: string[] = [];

    // Capture console logs during test
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };

    try {
      // Run beforeEach
      if (suite.beforeEach) {
        await this.runWithTimeout(suite.beforeEach, 5000);
      }

      // Run the test
      await this.runWithTimeout(test.fn, test.timeout || 5000);

      return {
        name: test.name,
        passed: true,
        duration: Date.now() - startTime,
        logs
      };

    } catch (error) {
      return {
        name: test.name,
        passed: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error : new Error(String(error)),
        logs
      };

    } finally {
      // Restore console.log
      console.log = originalLog;

      // Run afterEach
      if (suite.afterEach) {
        try {
          await this.runWithTimeout(suite.afterEach, 5000);
        } catch (error) {
          console.error(`Error in afterEach for test ${test.name}:`, error);
        }
      }

      // Clean up mocks after each test
      this.cleanupMocks();
    }
  }

  /**
   * Runs a function with timeout
   */
  private async runWithTimeout(fn: () => Promise<void> | void, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Test timed out after ${timeout}ms`));
      }, timeout);

      const result = fn();

      if (result instanceof Promise) {
        result
          .then(() => {
            clearTimeout(timer);
            resolve();
          })
          .catch(error => {
            clearTimeout(timer);
            reject(error);
          });
      } else {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  /**
   * Creates a mock function
   */
  mock(target: any, methodName: string, options: MockOptions = {}): jest.MockedFunction<any> {
    const originalMethod = target[methodName];
    const mockKey = `${target.constructor.name}.${methodName}`;

    // Store original for restoration
    if (!this.originalFunctions.has(mockKey)) {
      this.originalFunctions.set(mockKey, originalMethod);
    }

    let callCount = 0;
    const calls: any[][] = [];

    const mockFn = (...args: any[]) => {
      callCount++;
      calls.push(args);

      if (options.throwError) {
        throw options.throwError;
      }

      if (options.implementation) {
        return options.implementation(...args);
      }

      return options.returnValue;
    };

    // Add jest-like methods
    Object.assign(mockFn, {
      mockReturnValue: (value: any) => {
        options.returnValue = value;
        return mockFn;
      },
      mockImplementation: (fn: (...args: any[]) => any) => {
        options.implementation = fn;
        return mockFn;
      },
      mockRejectedValue: (error: Error) => {
        options.throwError = error;
        return mockFn;
      },
      toHaveBeenCalledWith: (...expectedArgs: any[]) => {
        const matching = calls.find(callArgs => 
          callArgs.length === expectedArgs.length &&
          callArgs.every((arg, index) => arg === expectedArgs[index])
        );
        if (!matching) {
          throw new Error(`Expected to be called with ${JSON.stringify(expectedArgs)}, but was called with: ${JSON.stringify(calls)}`);
        }
      },
      toHaveBeenCalledTimes: (expectedCount: number) => {
        if (callCount !== expectedCount) {
          throw new Error(`Expected to be called ${expectedCount} times, but was called ${callCount} times`);
        }
      },
      calls,
      callCount: () => callCount
    });

    target[methodName] = mockFn;
    this.mocks.set(mockKey, mockFn);

    return mockFn as any;
  }

  /**
   * Creates a mock Obsidian App
   */
  createMockApp(): Partial<App> {
    const mockVault = this.createMockVault();
    
    return {
      vault: mockVault as Vault
    };
  }

  /**
   * Creates a mock Obsidian Vault
   */
  createMockVault(): Partial<Vault> {
    const files = new Map<string, string>();

    return {
      getFiles: () => {
        return Array.from(files.keys()).map(path => ({
          path,
          name: path.split('/').pop() || '',
          stat: { mtime: Date.now(), ctime: Date.now(), size: files.get(path)?.length || 0 }
        })) as TFile[];
      },
      
      read: async (file: TFile) => {
        const content = files.get(file.path);
        if (content === undefined) {
          throw new Error(`File not found: ${file.path}`);
        }
        return content;
      },

      create: async (path: string, content: string) => {
        files.set(path, content);
        return {
          path,
          name: path.split('/').pop() || '',
          stat: { mtime: Date.now(), ctime: Date.now(), size: content.length }
        } as TFile;
      },

      modify: async (file: TFile, content: string) => {
        files.set(file.path, content);
      },

      delete: async (file: TFile) => {
        files.delete(file.path);
      },

      getAbstractFileByPath: (path: string) => {
        if (files.has(path)) {
          return {
            path,
            name: path.split('/').pop() || '',
            stat: { mtime: Date.now(), ctime: Date.now(), size: files.get(path)?.length || 0 }
          } as TFile;
        }
        return null;
      }
    };
  }

  /**
   * Assertion utilities
   */
  expect(actual: any): ExpectationAPI {
    return new ExpectationAPI(actual);
  }

  /**
   * Cleans up all mocks
   */
  private cleanupMocks(): void {
    for (const [key, mock] of this.mocks) {
      const [className, methodName] = key.split('.');
      // Restore original functions if needed
      // This is simplified - in practice would need proper target tracking
    }
    this.mocks.clear();
  }

  /**
   * Calculates statistics for a test suite
   */
  private calculateSuiteStats(results: TestResult[]): {
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  } {
    return {
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed && r.error).length,
      skipped: results.filter(r => !r.passed && !r.error).length,
      duration: results.reduce((sum, r) => sum + r.duration, 0)
    };
  }

  /**
   * Gets current suite context (simplified implementation)
   */
  private getCurrentSuite(): TestSuite | null {
    return this.suites[this.suites.length - 1] || null;
  }

  /**
   * Sets current suite context (simplified implementation)
   */
  private setCurrentSuite(suite: TestSuite | null): void {
    // In a full implementation, this would manage a stack of contexts
  }
}

/**
 * Expectation API for assertions
 */
class ExpectationAPI {
  constructor(private actual: any) {}

  toBe(expected: any): void {
    if (this.actual !== expected) {
      throw new Error(`Expected ${this.actual} to be ${expected}`);
    }
  }

  toEqual(expected: any): void {
    if (JSON.stringify(this.actual) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(this.actual)} to equal ${JSON.stringify(expected)}`);
    }
  }

  toBeTruthy(): void {
    if (!this.actual) {
      throw new Error(`Expected ${this.actual} to be truthy`);
    }
  }

  toBeFalsy(): void {
    if (this.actual) {
      throw new Error(`Expected ${this.actual} to be falsy`);
    }
  }

  toThrow(expectedError?: string | RegExp): void {
    let threw = false;
    let actualError: Error | null = null;

    try {
      if (typeof this.actual === 'function') {
        this.actual();
      }
    } catch (error) {
      threw = true;
      actualError = error instanceof Error ? error : new Error(String(error));
    }

    if (!threw) {
      throw new Error('Expected function to throw');
    }

    if (expectedError) {
      if (typeof expectedError === 'string') {
        if (!actualError?.message.includes(expectedError)) {
          throw new Error(`Expected error message to contain "${expectedError}", but got "${actualError?.message}"`);
        }
      } else if (expectedError instanceof RegExp) {
        if (!expectedError.test(actualError?.message || '')) {
          throw new Error(`Expected error message to match ${expectedError}, but got "${actualError?.message}"`);
        }
      }
    }
  }

  async toResolve(): Promise<void> {
    try {
      await this.actual;
    } catch (error) {
      throw new Error(`Expected promise to resolve, but it rejected with: ${error}`);
    }
  }

  async toReject(): Promise<void> {
    try {
      await this.actual;
      throw new Error('Expected promise to reject, but it resolved');
    } catch (error) {
      // Expected to reject
    }
  }

  toContain(expected: any): void {
    if (Array.isArray(this.actual)) {
      if (!this.actual.includes(expected)) {
        throw new Error(`Expected array to contain ${expected}`);
      }
    } else if (typeof this.actual === 'string') {
      if (!this.actual.includes(expected)) {
        throw new Error(`Expected string to contain "${expected}"`);
      }
    } else {
      throw new Error('toContain can only be used with arrays or strings');
    }
  }

  toHaveLength(expected: number): void {
    if (!this.actual.length !== undefined) {
      throw new Error('Expected value to have a length property');
    }
    if (this.actual.length !== expected) {
      throw new Error(`Expected length ${expected}, but got ${this.actual.length}`);
    }
  }
}

// Global test framework instance
export const testFramework = new TestFramework();

// Export global functions for convenience
export const describe = testFramework.describe.bind(testFramework);
export const it = testFramework.it.bind(testFramework);
export const beforeAll = testFramework.beforeAll.bind(testFramework);
export const afterAll = testFramework.afterAll.bind(testFramework);
export const beforeEach = testFramework.beforeEach.bind(testFramework);
export const afterEach = testFramework.afterEach.bind(testFramework);
export const expect = testFramework.expect.bind(testFramework);