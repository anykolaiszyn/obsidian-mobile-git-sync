# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a mobile-first Git sync plugin for Obsidian that provides bidirectional synchronization with GitHub repositories. The plugin is specifically designed to work reliably on mobile devices (Android/iOS) while maintaining desktop functionality.

## Development Commands

- **Development build with watch**: `npm run dev`
- **Production build**: `npm run build` 
- **Version bump**: `npm run version` (updates manifest.json and versions.json)
- **Type checking**: `tsc -noEmit -skipLibCheck` (part of build process)

The build system uses esbuild for bundling and TypeScript for compilation. Development mode enables file watching and inline source maps.

## Architecture Overview

### Enterprise Service-Oriented Architecture
- **Main Plugin Class**: `MobileGitSyncPlugin` extends Obsidian's `Plugin` class in `main.ts`
- **Dependency Injection**: `ServiceContainer` manages service lifecycle and dependencies
- **Modular Services**: 15+ specialized services for different concerns
- **Type Definitions**: Comprehensive TypeScript interfaces in `src/types.ts`

### Core Services

#### 🧠 **Intelligence & Planning**
- **SyncPlannerService** (`src/services/syncPlannerService.ts`): Intelligent sync planning with risk assessment
- **ConflictResolutionService** (`src/services/conflictService.ts`): Advanced three-way merge capabilities
- **SyncService** (`src/services/syncService.ts`): Core synchronization orchestration

#### 📱 **Mobile Optimization**
- **MobileOptimizerService** (`src/services/mobileOptimizer.ts`): Battery-aware scheduling and data controls
- **GestureHandlerService** (`src/ui/gestureHandler.ts`): Touch gesture recognition system
- **PWAService** (`src/services/pwaService.ts`): Progressive web app features with offline queue

#### 🔒 **Security & Infrastructure**
- **CryptoManager** (`src/utils/crypto.ts`): AES-GCM encryption for secure storage
- **SecureTokenManager** (`src/utils/secureStorage.ts`): GitHub token management with validation
- **IntelligentErrorHandler** (`src/utils/errorHandler.ts`): Context-aware error recovery
- **Logger** (`src/utils/logger.ts`): Structured logging with analytics

#### 🚀 **Performance & Streaming**
- **StreamProcessor** (`src/services/streamProcessor.ts`): Memory-efficient large file processing
- **MemoryManager** (`src/services/memoryManager.ts`): Automatic memory optimization
- **PerformanceMonitor** (`src/services/performanceMonitor.ts`): Real-time metrics collection

#### 🎨 **User Interface**
- **MobileModal** (`src/ui/mobileModal.ts`): Touch-friendly modal system
- **AdvancedConflictModal** (`src/ui/conflictModal.ts`): Professional diff viewer
- **AnalyticsDashboard** (`src/ui/analyticsDashboard.ts`): Interactive performance analytics
- **StatusBarManager** (`src/ui/statusBarManager.ts`): Real-time sync status display

### Service Integration Patterns
- **Dependency Injection**: All services registered with container and injected as needed
- **Lifecycle Management**: Services implement `DisposableService` with proper cleanup
- **Event-Driven**: Services communicate through events and callbacks
- **Error Boundaries**: Each service has comprehensive error handling with recovery

### Data Flow
1. File changes detected via Obsidian's vault events
2. Changes queued and debounced to prevent spam
3. Sync operations compare local vs remote state
4. GitHub API used for all remote operations
5. Conflicts resolved based on configured strategy

### Key Technical Patterns
- **Event-driven architecture** for file change detection
- **Promise-based async operations** throughout
- **Comprehensive error handling** with retry logic
- **Mobile-optimized UI** with touch-friendly interfaces
- **Status tracking** with real-time progress updates

## Dependencies

- **isomorphic-git**: Git operations (primary dependency)
- **obsidian**: Obsidian API types and functionality
- **esbuild**: Build tooling for bundling
- **typescript**: Type checking and compilation

## Testing Strategy

The plugin includes a manual test script in the README covering:
- Installation and configuration
- All sync commands and operations
- Conflict resolution scenarios
- Error handling and recovery
- Cross-device functionality

No automated test suite is present - testing is primarily manual and user-driven.

## File Structure Notes

- Plugin manifest in `manifest.json` with mobile compatibility (`"isDesktopOnly": false`)
- Version management through `versions.json` and automated bumping
- Single TypeScript entry point with comprehensive type safety
- CSS styling in `styles.css` for UI components

## Obsidian Plugin Development Patterns

When working with this Obsidian plugin, follow these established patterns:

### Plugin Class Structure
```typescript
export default class MyPlugin extends Plugin {
  settings!: PluginSettings;
  statusBarItem: HTMLElement | null = null;
  
  async onload() {
    await this.loadSettings();
    this.addCommands();
    this.setupUI();
    this.registerEvents();
  }
  
  onunload() {
    // Cleanup resources
  }
}
```

### Command Registration
- Use descriptive names with emoji prefixes for better UX
- Include hotkey bindings for power users
- Follow the pattern: `id`, `name`, `callback`, `hotkeys`
- Use consistent naming: `plugin-name-action-description`

### Event Handling
- Register events using `this.registerEvent()`
- Use debouncing for high-frequency events (file changes)
- Clean up event listeners in `onunload()`
- Handle vault events: `modify`, `create`, `delete`, `rename`

### Settings Management
- Extend `PluginSettingTab` for settings UI
- Use `loadSettings()` and `saveSettings()` methods
- Provide sensible defaults in `DEFAULT_SETTINGS`
- Validate settings before applying

### UI Components
- **Status Bar**: Use `this.addStatusBarItem()` for persistent status
- **Ribbon Icons**: Use `this.addRibbonIcon()` for quick access
- **Modals**: Extend `Modal` class for dialogs and forms
- **Settings Tab**: Extend `PluginSettingTab` for configuration

### Mobile Compatibility
- Set `"isDesktopOnly": false` in manifest.json
- Use touch-friendly button sizes and spacing
- Test on actual mobile devices, not just browser dev tools
- Handle memory constraints and slower performance
- Provide mobile-specific UI optimizations

### Error Handling
- Use try-catch blocks around async operations
- Provide user-friendly error messages via `Notice`
- Log detailed errors for debugging
- Implement retry logic for network operations
- Handle offline scenarios gracefully

### API Integration
- Use `requestUrl()` for HTTP requests (Obsidian's built-in method)
- Handle rate limiting and API quotas
- Store sensitive data (tokens) securely in settings
- Validate API responses before processing

### Performance Considerations
- Debounce frequent operations (file watching)
- Use efficient data structures (Map, Set)
- Minimize DOM manipulation
- Implement progress indicators for long operations
- Cache frequently accessed data