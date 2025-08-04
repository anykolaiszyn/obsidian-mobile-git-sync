/**
 * Dependency Injection Container
 * 
 * Provides service registration, dependency resolution, and lifecycle management
 * for the modular architecture
 */

export type ServiceFactory<T> = () => T | Promise<T>;
export type ServiceLifecycle = 'singleton' | 'transient' | 'scoped';

export interface ServiceDefinition<T = any> {
  factory: ServiceFactory<T>;
  lifecycle: ServiceLifecycle;
  instance?: T;
  dependencies?: string[];
}

export interface ServiceMetadata {
  name: string;
  type: string;
  lifecycle: ServiceLifecycle;
  dependencies: string[];
  created: number;
  lastAccessed?: number;
  accessCount: number;
}

export class ServiceContainer {
  private services = new Map<string, ServiceDefinition>();
  private singletonInstances = new Map<string, any>();
  private scopedInstances = new Map<string, any>();
  private metadata = new Map<string, ServiceMetadata>();
  private isDisposed = false;

  /**
   * Registers a service with the container
   */
  register<T>(
    token: string,
    factory: ServiceFactory<T>,
    lifecycle: ServiceLifecycle = 'singleton',
    dependencies: string[] = []
  ): void {
    if (this.isDisposed) {
      throw new Error('Cannot register services on disposed container');
    }

    this.services.set(token, {
      factory,
      lifecycle,
      dependencies
    });

    this.metadata.set(token, {
      name: token,
      type: typeof factory,
      lifecycle,
      dependencies,
      created: Date.now(),
      accessCount: 0
    });
  }

  /**
   * Registers a singleton service
   */
  registerSingleton<T>(token: string, factory: ServiceFactory<T>, dependencies: string[] = []): void {
    this.register(token, factory, 'singleton', dependencies);
  }

  /**
   * Registers a transient service (new instance each time)
   */
  registerTransient<T>(token: string, factory: ServiceFactory<T>, dependencies: string[] = []): void {
    this.register(token, factory, 'transient', dependencies);
  }

  /**
   * Registers a scoped service (same instance within scope)
   */
  registerScoped<T>(token: string, factory: ServiceFactory<T>, dependencies: string[] = []): void {
    this.register(token, factory, 'scoped', dependencies);
  }

  /**
   * Resolves a service from the container
   */
  async get<T>(token: string): Promise<T> {
    if (this.isDisposed) {
      throw new Error('Cannot resolve services from disposed container');
    }

    const definition = this.services.get(token);
    if (!definition) {
      throw new Error(`Service '${token}' is not registered`);
    }

    // Update metadata
    const meta = this.metadata.get(token)!;
    meta.lastAccessed = Date.now();
    meta.accessCount++;

    // Handle different lifecycles
    switch (definition.lifecycle) {
      case 'singleton':
        return this.getSingleton<T>(token, definition);
      
      case 'transient':
        return this.createInstance<T>(definition);
      
      case 'scoped':
        return this.getScoped<T>(token, definition);
      
      default:
        throw new Error(`Unknown lifecycle: ${definition.lifecycle}`);
    }
  }

  /**
   * Resolves a service synchronously (throws if async)
   */
  getSync<T>(token: string): T {
    const result = this.get<T>(token);
    
    if (result instanceof Promise) {
      throw new Error(`Service '${token}' requires async resolution`);
    }
    
    return result as T;
  }

  /**
   * Checks if a service is registered
   */
  has(token: string): boolean {
    return this.services.has(token);
  }

  /**
   * Unregisters a service
   */
  unregister(token: string): void {
    this.services.delete(token);
    this.singletonInstances.delete(token);
    this.scopedInstances.delete(token);
    this.metadata.delete(token);
  }

  /**
   * Creates a new scope for scoped services
   */
  createScope(): ServiceScope {
    return new ServiceScope(this);
  }

  /**
   * Gets service metadata for debugging and monitoring
   */
  getMetadata(): ServiceMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * Gets service dependency graph
   */
  getDependencyGraph(): Record<string, string[]> {
    const graph: Record<string, string[]> = {};
    
    for (const [token, definition] of this.services) {
      graph[token] = definition.dependencies || [];
    }
    
    return graph;
  }

  /**
   * Validates service dependencies for circular references
   */
  validateDependencies(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (token: string, path: string[] = []): void => {
      if (visiting.has(token)) {
        errors.push(`Circular dependency detected: ${path.join(' -> ')} -> ${token}`);
        return;
      }

      if (visited.has(token)) {
        return;
      }

      const definition = this.services.get(token);
      if (!definition) {
        errors.push(`Missing dependency: ${token}`);
        return;
      }

      visiting.add(token);
      
      for (const dep of definition.dependencies || []) {
        visit(dep, [...path, token]);
      }
      
      visiting.delete(token);
      visited.add(token);
    };

    for (const token of this.services.keys()) {
      if (!visited.has(token)) {
        visit(token);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Disposes the container and all singleton instances
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    // Dispose singleton instances that implement IDisposable
    for (const [token, instance] of this.singletonInstances) {
      if (instance && typeof instance.dispose === 'function') {
        try {
          await instance.dispose();
        } catch (error) {
          console.error(`Error disposing service '${token}':`, error);
        }
      }
    }

    this.services.clear();
    this.singletonInstances.clear();
    this.scopedInstances.clear();
    this.metadata.clear();
    this.isDisposed = true;
  }

  /**
   * Gets or creates a singleton instance
   */
  private async getSingleton<T>(token: string, definition: ServiceDefinition): Promise<T> {
    let instance = this.singletonInstances.get(token);
    
    if (!instance) {
      instance = await this.createInstance<T>(definition);
      this.singletonInstances.set(token, instance);
    }
    
    return instance;
  }

  /**
   * Gets or creates a scoped instance
   */
  private async getScoped<T>(token: string, definition: ServiceDefinition): Promise<T> {
    let instance = this.scopedInstances.get(token);
    
    if (!instance) {
      instance = await this.createInstance<T>(definition);
      this.scopedInstances.set(token, instance);
    }
    
    return instance;
  }

  /**
   * Creates a new service instance
   */
  private async createInstance<T>(definition: ServiceDefinition): Promise<T> {
    // Resolve dependencies first
    const dependencies: any[] = [];
    
    if (definition.dependencies) {
      for (const dep of definition.dependencies) {
        dependencies.push(await this.get(dep));
      }
    }

    // Create instance
    const result = definition.factory();
    
    if (result instanceof Promise) {
      return await result;
    }
    
    return result as T;
  }
}

/**
 * Service scope for scoped services
 */
export class ServiceScope {
  private scopedInstances = new Map<string, any>();

  constructor(private container: ServiceContainer) {}

  /**
   * Gets a service within this scope
   */
  async get<T>(token: string): Promise<T> {
    // For scoped services, use scope-specific instances
    const definition = (this.container as any).services.get(token);
    
    if (definition?.lifecycle === 'scoped') {
      let instance = this.scopedInstances.get(token);
      
      if (!instance) {
        instance = await (this.container as any).createInstance(definition);
        this.scopedInstances.set(token, instance);
      }
      
      return instance;
    }
    
    // For other lifecycles, delegate to container
    return this.container.get<T>(token);
  }

  /**
   * Disposes the scope and all scoped instances
   */
  async dispose(): Promise<void> {
    for (const [token, instance] of this.scopedInstances) {
      if (instance && typeof instance.dispose === 'function') {
        try {
          await instance.dispose();
        } catch (error) {
          console.error(`Error disposing scoped service '${token}':`, error);
        }
      }
    }
    
    this.scopedInstances.clear();
  }
}

/**
 * Interface for disposable services
 */
export interface IDisposable {
  dispose(): void | Promise<void>;
}

/**
 * Base class for services that need disposal
 */
export abstract class DisposableService implements IDisposable {
  protected isDisposed = false;

  abstract dispose(): void | Promise<void>;

  protected checkDisposed(): void {
    if (this.isDisposed) {
      throw new Error('Service has been disposed');
    }
  }
}