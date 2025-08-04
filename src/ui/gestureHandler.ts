/**
 * Mobile Gesture Handler
 * 
 * Provides intuitive gesture support for common sync operations,
 * optimized for mobile touch interfaces
 */

import { DisposableService } from '../core/container';
import { Logger } from '../utils/logger';

export interface GestureConfig {
  swipeThreshold: number;
  swipeVelocityThreshold: number;
  longPressDelay: number;
  doubleClickDelay: number;
  pinchThreshold: number;
  enableHapticFeedback: boolean;
}

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
  timestamp: number;
}

export interface GestureEvent {
  type: 'swipe' | 'pinch' | 'longpress' | 'doubleclick' | 'pull-to-refresh';
  direction?: 'up' | 'down' | 'left' | 'right';
  velocity?: number;
  scale?: number;
  element: HTMLElement;
  originalEvent: TouchEvent | MouseEvent;
  data?: any;
}

export type GestureHandler = (event: GestureEvent) => void | Promise<void>;

export interface GestureBinding {
  element: HTMLElement;
  gestures: Set<string>;
  handlers: Map<string, GestureHandler>;
  config?: Partial<GestureConfig>;
}

export class GestureHandlerService extends DisposableService {
  private bindings = new Map<HTMLElement, GestureBinding>();
  private activeTouches = new Map<number, TouchPoint>();
  private gestureStartTime = 0;
  private lastClickTime = 0;
  private longPressTimer: NodeJS.Timeout | null = null;
  private isProcessingGesture = false;

  private readonly defaultConfig: GestureConfig = {
    swipeThreshold: 50, // minimum distance for swipe
    swipeVelocityThreshold: 0.3, // minimum velocity for swipe
    longPressDelay: 800, // milliseconds
    doubleClickDelay: 300, // milliseconds
    pinchThreshold: 0.1, // minimum scale change for pinch
    enableHapticFeedback: true
  };

  constructor(
    private logger: Logger,
    private mobileOptimizer?: any // MobileOptimizerService for haptic feedback
  ) {
    super();
    this.setupGlobalListeners();
  }

  /**
   * Binds gesture handlers to an element
   */
  bindGestures(
    element: HTMLElement,
    gestureHandlers: Partial<Record<GestureEvent['type'], GestureHandler>>,
    config?: Partial<GestureConfig>
  ): void {
    this.checkDisposed();

    const binding: GestureBinding = {
      element,
      gestures: new Set(Object.keys(gestureHandlers)),
      handlers: new Map(Object.entries(gestureHandlers)),
      config: { ...this.defaultConfig, ...config }
    };

    this.bindings.set(element, binding);
    this.setupElementListeners(element);

    this.logger.debug('Gesture binding created', {
      component: 'GestureHandler',
      element: element.tagName,
      gestures: Array.from(binding.gestures)
    });
  }

  /**
   * Unbinds gesture handlers from an element
   */
  unbindGestures(element: HTMLElement): void {
    const binding = this.bindings.get(element);
    if (binding) {
      this.removeElementListeners(element);
      this.bindings.delete(element);
      
      this.logger.debug('Gesture binding removed', {
        component: 'GestureHandler',
        element: element.tagName
      });
    }
  }

  /**
   * Creates a swipeable list with common sync operations
   */
  createSwipeableList(container: HTMLElement): void {
    const items = container.querySelectorAll('.swipeable-item');
    
    items.forEach(item => {
      const htmlItem = item as HTMLElement;
      
      this.bindGestures(htmlItem, {
        swipe: async (event) => {
          await this.handleListItemSwipe(htmlItem, event);
        }
      });

      // Add visual indicators
      this.addSwipeIndicators(htmlItem);
    });
  }

  /**
   * Creates a pull-to-refresh gesture for sync triggering
   */
  createPullToRefresh(
    container: HTMLElement,
    onRefresh: () => Promise<void>
  ): void {
    let pullStartY = 0;
    let isPulling = false;
    let pullDistance = 0;
    const refreshThreshold = 80;

    this.bindGestures(container, {
      'pull-to-refresh': async (event) => {
        await onRefresh();
        this.triggerHaptic('success');
      }
    });

    // Custom pull-to-refresh implementation
    const handleTouchStart = (e: TouchEvent) => {
      if (container.scrollTop === 0) {
        pullStartY = e.touches[0].clientY;
        isPulling = true;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPulling) return;

      pullDistance = e.touches[0].clientY - pullStartY;
      
      if (pullDistance > 0) {
        e.preventDefault();
        this.updatePullIndicator(container, pullDistance, refreshThreshold);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!isPulling) return;

      isPulling = false;
      
      if (pullDistance >= refreshThreshold) {
        this.triggerGesture(container, {
          type: 'pull-to-refresh',
          element: container,
          originalEvent: e
        });
      }
      
      this.resetPullIndicator(container);
      pullDistance = 0;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
  }

  /**
   * Sets up global touch listeners
   */
  private setupGlobalListeners(): void {
    // Prevent default touch behaviors that interfere with gestures
    document.addEventListener('touchmove', (e) => {
      if (this.isProcessingGesture) {
        e.preventDefault();
      }
    }, { passive: false });

    // Cleanup active touches on window events
    window.addEventListener('blur', () => this.clearActiveTouches());
    window.addEventListener('contextmenu', (e) => {
      if (this.isProcessingGesture) {
        e.preventDefault();
      }
    });
  }

  /**
   * Sets up event listeners for a specific element
   */
  private setupElementListeners(element: HTMLElement): void {
    element.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    element.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    element.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
    element.addEventListener('touchcancel', this.handleTouchCancel.bind(this));
    
    // Mouse events for desktop testing
    element.addEventListener('mousedown', this.handleMouseDown.bind(this));
    element.addEventListener('mousemove', this.handleMouseMove.bind(this));
    element.addEventListener('mouseup', this.handleMouseUp.bind(this));
  }

  /**
   * Removes event listeners from an element
   */
  private removeElementListeners(element: HTMLElement): void {
    element.removeEventListener('touchstart', this.handleTouchStart.bind(this));
    element.removeEventListener('touchmove', this.handleTouchMove.bind(this));
    element.removeEventListener('touchend', this.handleTouchEnd.bind(this));
    element.removeEventListener('touchcancel', this.handleTouchCancel.bind(this));
    element.removeEventListener('mousedown', this.handleMouseDown.bind(this));
    element.removeEventListener('mousemove', this.handleMouseMove.bind(this));
    element.removeEventListener('mouseup', this.handleMouseUp.bind(this));
  }

  /**
   * Handles touch start events
   */
  private handleTouchStart(event: TouchEvent): void {
    const element = event.currentTarget as HTMLElement;
    const binding = this.bindings.get(element);
    if (!binding) return;

    this.gestureStartTime = Date.now();
    
    // Store touch points
    Array.from(event.touches).forEach(touch => {
      this.activeTouches.set(touch.identifier, {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        timestamp: Date.now()
      });
    });

    // Start long press timer if gesture is supported
    if (binding.gestures.has('longpress')) {
      this.startLongPressTimer(element, event);
    }

    this.logger.debug('Touch started', {
      component: 'GestureHandler',
      touches: this.activeTouches.size,
      element: element.tagName
    });
  }

  /**
   * Handles touch move events
   */
  private handleTouchMove(event: TouchEvent): void {
    const element = event.currentTarget as HTMLElement;
    const binding = this.bindings.get(element);
    if (!binding) return;

    // Cancel long press on movement
    this.cancelLongPress();

    // Update touch positions
    Array.from(event.touches).forEach(touch => {
      const existing = this.activeTouches.get(touch.identifier);
      if (existing) {
        this.activeTouches.set(touch.identifier, {
          ...existing,
          x: touch.clientX,
          y: touch.clientY
        });
      }
    });

    // Check for pinch gesture
    if (binding.gestures.has('pinch') && this.activeTouches.size === 2) {
      this.detectPinchGesture(element, event, binding);
    }
  }

  /**
   * Handles touch end events
   */
  private handleTouchEnd(event: TouchEvent): void {
    const element = event.currentTarget as HTMLElement;
    const binding = this.bindings.get(element);
    if (!binding) return;

    this.cancelLongPress();

    // Process single-touch gestures
    if (this.activeTouches.size === 1) {
      const touchId = Array.from(this.activeTouches.keys())[0];
      const touch = this.activeTouches.get(touchId);
      
      if (touch) {
        // Check for swipe
        if (binding.gestures.has('swipe')) {
          this.detectSwipeGesture(element, touch, event, binding);
        }

        // Check for double-click
        if (binding.gestures.has('doubleclick')) {
          this.detectDoubleClick(element, event, binding);
        }
      }
    }

    // Remove ended touches
    Array.from(event.changedTouches).forEach(touch => {
      this.activeTouches.delete(touch.identifier);
    });

    // Clear all touches if none remain active
    if (event.touches.length === 0) {
      this.clearActiveTouches();
    }
  }

  /**
   * Handles touch cancel events
   */
  private handleTouchCancel(event: TouchEvent): void {
    this.cancelLongPress();
    this.clearActiveTouches();
    this.isProcessingGesture = false;
  }

  /**
   * Mouse event handlers for desktop testing
   */
  private handleMouseDown(event: MouseEvent): void {
    // Simulate touch start with mouse
    const simulatedTouch = {
      identifier: 0,
      clientX: event.clientX,
      clientY: event.clientY
    };

    this.activeTouches.set(0, {
      id: 0,
      x: event.clientX,
      y: event.clientY,
      timestamp: Date.now()
    });

    this.gestureStartTime = Date.now();
  }

  private handleMouseMove(event: MouseEvent): void {
    const existing = this.activeTouches.get(0);
    if (existing) {
      this.activeTouches.set(0, {
        ...existing,
        x: event.clientX,
        y: event.clientY
      });
    }
  }

  private handleMouseUp(event: MouseEvent): void {
    const element = event.currentTarget as HTMLElement;
    const binding = this.bindings.get(element);
    const touch = this.activeTouches.get(0);

    if (binding && touch && binding.gestures.has('swipe')) {
      this.detectSwipeGesture(element, touch, event, binding);
    }

    this.clearActiveTouches();
  }

  /**
   * Detects swipe gestures
   */
  private detectSwipeGesture(
    element: HTMLElement,
    startTouch: TouchPoint,
    event: TouchEvent | MouseEvent,
    binding: GestureBinding
  ): void {
    const config = binding.config || this.defaultConfig;
    const currentTime = Date.now();
    const duration = currentTime - startTouch.timestamp;
    
    const currentX = 'touches' in event ? event.changedTouches[0].clientX : (event as MouseEvent).clientX;
    const currentY = 'touches' in event ? event.changedTouches[0].clientY : (event as MouseEvent).clientY;
    
    const deltaX = currentX - startTouch.x;
    const deltaY = currentY - startTouch.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const velocity = distance / duration;

    if (distance >= (config?.swipeThreshold || 50) && velocity >= (config?.swipeVelocityThreshold || 0.1)) {
      let direction: GestureEvent['direction'];
      
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        direction = deltaX > 0 ? 'right' : 'left';
      } else {
        direction = deltaY > 0 ? 'down' : 'up';
      }

      this.triggerGesture(element, {
        type: 'swipe',
        direction,
        velocity,
        element,
        originalEvent: event
      });
    }
  }

  /**
   * Detects pinch gestures
   */
  private detectPinchGesture(
    element: HTMLElement,
    event: TouchEvent,
    binding: GestureBinding
  ): void {
    const touches = Array.from(this.activeTouches.values());
    if (touches.length !== 2) return;

    const [touch1, touch2] = touches;
    const currentDistance = Math.sqrt(
      Math.pow(touch1.x - touch2.x, 2) + Math.pow(touch1.y - touch2.y, 2)
    );

    // Calculate initial distance (stored in element data)
    const initialDistance = element.dataset.initialPinchDistance;
    if (!initialDistance) {
      element.dataset.initialPinchDistance = currentDistance.toString();
      return;
    }

    const scale = currentDistance / parseFloat(initialDistance);
    const config = binding.config || this.defaultConfig;

    if (Math.abs(scale - 1) >= (config?.pinchThreshold || 0.1)) {
      this.triggerGesture(element, {
        type: 'pinch',
        scale,
        element,
        originalEvent: event
      });
    }
  }

  /**
   * Detects double-click gestures
   */
  private detectDoubleClick(
    element: HTMLElement,
    event: TouchEvent | MouseEvent,
    binding: GestureBinding
  ): void {
    const currentTime = Date.now();
    const config = binding.config || this.defaultConfig;

    if (currentTime - this.lastClickTime <= (config?.doubleClickDelay || 300)) {
      this.triggerGesture(element, {
        type: 'doubleclick',
        element,
        originalEvent: event
      });
    }

    this.lastClickTime = currentTime;
  }

  /**
   * Starts long press timer
   */
  private startLongPressTimer(element: HTMLElement, event: TouchEvent): void {
    const binding = this.bindings.get(element);
    if (!binding) return;

    const config = binding.config || this.defaultConfig;

    this.longPressTimer = setTimeout(() => {
      this.triggerGesture(element, {
        type: 'longpress',
        element,
        originalEvent: event
      });
      this.longPressTimer = null;
    }, config.longPressDelay);
  }

  /**
   * Cancels long press timer
   */
  private cancelLongPress(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  /**
   * Triggers a gesture event
   */
  private async triggerGesture(element: HTMLElement, gestureEvent: GestureEvent): Promise<void> {
    const binding = this.bindings.get(element);
    if (!binding) return;

    const handler = binding.handlers.get(gestureEvent.type);
    if (!handler) return;

    this.isProcessingGesture = true;

    try {
      await handler(gestureEvent);
      this.triggerHaptic('selection');
      
      this.logger.debug('Gesture triggered', {
        component: 'GestureHandler',
        type: gestureEvent.type,
        direction: gestureEvent.direction,
        element: element.tagName
      });
    } catch (error) {
      this.logger.error('Gesture handler failed', { error, gestureEvent });
      this.triggerHaptic('error');
    } finally {
      this.isProcessingGesture = false;
    }
  }

  /**
   * Handles list item swipe actions
   */
  private async handleListItemSwipe(item: HTMLElement, event: GestureEvent): Promise<void> {
    const action = item.dataset.swipeAction;
    
    switch (event.direction) {
      case 'left':
        // Reveal action buttons
        this.revealActionButtons(item, 'right');
        break;
      case 'right':
        // Reveal action buttons
        this.revealActionButtons(item, 'left');
        break;
      case 'up':
        // Archive or hide
        if (action === 'archive') {
          await this.animateItemRemoval(item);
        }
        break;
      case 'down':
        // Show details or expand
        this.expandItem(item);
        break;
    }
  }

  /**
   * Reveals action buttons for a list item
   */
  private revealActionButtons(item: HTMLElement, side: 'left' | 'right'): void {
    const actionsContainer = item.querySelector(`.actions-${side}`) as HTMLElement;
    if (actionsContainer) {
      actionsContainer.style.transform = side === 'left' ? 'translateX(0)' : 'translateX(0)';
      item.addClass('actions-revealed');
      
      // Auto-hide after delay
      setTimeout(() => {
        this.hideActionButtons(item);
      }, 3000);
    }
  }

  /**
   * Hides action buttons for a list item
   */
  private hideActionButtons(item: HTMLElement): void {
    const actionsLeft = item.querySelector('.actions-left') as HTMLElement;
    const actionsRight = item.querySelector('.actions-right') as HTMLElement;
    
    if (actionsLeft) actionsLeft.style.transform = 'translateX(-100%)';
    if (actionsRight) actionsRight.style.transform = 'translateX(100%)';
    
    item.removeClass('actions-revealed');
  }

  /**
   * Animates item removal
   */
  private async animateItemRemoval(item: HTMLElement): Promise<void> {
    item.style.transition = 'all 0.3s ease-out';
    item.style.transform = 'translateX(-100%)';
    item.style.opacity = '0';
    
    return new Promise(resolve => {
      setTimeout(() => {
        item.remove();
        resolve();
      }, 300);
    });
  }

  /**
   * Expands an item to show details
   */
  private expandItem(item: HTMLElement): void {
    const details = item.querySelector('.item-details') as HTMLElement;
    if (details) {
      const isExpanded = item.hasClass('expanded');
      
      if (isExpanded) {
        item.removeClass('expanded');
        details.style.maxHeight = '0';
      } else {
        item.addClass('expanded');
        details.style.maxHeight = details.scrollHeight + 'px';
      }
    }
  }

  /**
   * Adds swipe indicators to list items
   */
  private addSwipeIndicators(item: HTMLElement): void {
    // Add left action buttons
    const leftActions = item.createEl('div', { cls: 'actions-left' });
    leftActions.createEl('button', { 
      text: 'Sync',
      cls: 'action-btn sync-btn',
      attr: { 'data-action': 'sync' }
    });
    
    // Add right action buttons
    const rightActions = item.createEl('div', { cls: 'actions-right' });
    rightActions.createEl('button', { 
      text: 'Delete',
      cls: 'action-btn delete-btn',
      attr: { 'data-action': 'delete' }
    });
    
    // Add swipe indicators
    const swipeHint = item.createEl('div', { cls: 'swipe-hint' });
    swipeHint.innerHTML = '← Swipe for actions →';
  }

  /**
   * Updates pull-to-refresh indicator
   */
  private updatePullIndicator(container: HTMLElement, distance: number, threshold: number): void {
    let indicator = container.querySelector('.pull-indicator') as HTMLElement;
    
    if (!indicator) {
      indicator = container.createEl('div', { cls: 'pull-indicator' });
      indicator.innerHTML = '↓ Pull to refresh';
    }
    
    const progress = Math.min(distance / threshold, 1);
    indicator.style.opacity = progress.toString();
    indicator.style.transform = `translateY(${Math.min(distance, threshold)}px)`;
    
    if (progress >= 1) {
      indicator.innerHTML = '↻ Release to refresh';
      indicator.addClass('ready');
    } else {
      indicator.innerHTML = '↓ Pull to refresh';
      indicator.removeClass('ready');
    }
  }

  /**
   * Resets pull-to-refresh indicator
   */
  private resetPullIndicator(container: HTMLElement): void {
    const indicator = container.querySelector('.pull-indicator') as HTMLElement;
    if (indicator) {
      indicator.style.transform = 'translateY(-100%)';
      setTimeout(() => {
        indicator.remove();
      }, 300);
    }
  }

  /**
   * Triggers haptic feedback
   */
  private triggerHaptic(type: 'success' | 'error' | 'warning' | 'selection' | 'impact'): void {
    if (this.mobileOptimizer && this.mobileOptimizer.triggerHapticFeedback) {
      this.mobileOptimizer.triggerHapticFeedback(type);
    }
  }

  /**
   * Clears all active touches
   */
  private clearActiveTouches(): void {
    this.activeTouches.clear();
    
    // Clear pinch distance data from all elements
    this.bindings.forEach((_, element) => {
      delete element.dataset.initialPinchDistance;
    });
  }

  /**
   * Disposes the gesture handler
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.cancelLongPress();
    this.clearActiveTouches();
    
    // Remove all bindings
    for (const element of this.bindings.keys()) {
      this.unbindGestures(element);
    }
    
    this.bindings.clear();
    this.isDisposed = true;
  }
}