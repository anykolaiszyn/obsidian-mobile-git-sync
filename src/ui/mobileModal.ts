/**
 * Mobile-Optimized Modal System
 * 
 * Provides responsive, touch-friendly modals with gesture support,
 * adaptive layouts, and mobile-specific interactions
 */

import { Modal, App, Setting } from 'obsidian';
import { GestureHandlerService } from './gestureHandler';

export interface MobileModalConfig {
  fullscreen: boolean;
  swipeToClose: boolean;
  tapBackdropToClose: boolean;
  showHandle: boolean;
  adaptiveHeight: boolean;
  gestureEnabled: boolean;
  hapticFeedback: boolean;
  animationDuration: number;
}

export interface MobileModalButton {
  text: string;
  style: 'primary' | 'secondary' | 'danger' | 'success';
  action: () => void | Promise<void>;
  disabled?: boolean;
  icon?: string;
}

export interface MobileModalSection {
  title?: string;
  content: HTMLElement | string;
  collapsible?: boolean;
  collapsed?: boolean;
}

export class MobileModal extends Modal {
  private config: MobileModalConfig;
  private gestureHandler?: GestureHandlerService;
  private sections: MobileModalSection[] = [];
  private buttons: MobileModalButton[] = [];
  private startY = 0;
  private currentTranslateY = 0;
  private isDragging = false;
  private isClosing = false;

  private readonly defaultConfig: MobileModalConfig = {
    fullscreen: false,
    swipeToClose: true,
    tapBackdropToClose: true,
    showHandle: true,
    adaptiveHeight: true,
    gestureEnabled: true,
    hapticFeedback: true,
    animationDuration: 300
  };

  constructor(
    app: App,
    private title: string,
    config: Partial<MobileModalConfig> = {},
    gestureHandler?: GestureHandlerService
  ) {
    super(app);
    this.config = { ...this.defaultConfig, ...config };
    this.gestureHandler = gestureHandler;
  }

  /**
   * Adds a section to the modal
   */
  addSection(section: MobileModalSection): void {
    this.sections.push(section);
  }

  /**
   * Adds a button to the modal
   */
  addButton(button: MobileModalButton): void {
    this.buttons.push(button);
  }

  /**
   * Sets the modal content using sections
   */
  setContent(sections: MobileModalSection[]): void {
    this.sections = sections;
  }

  /**
   * Sets the modal buttons
   */
  setButtons(buttons: MobileModalButton[]): void {
    this.buttons = buttons;
  }

  /**
   * Opens the modal with mobile optimizations
   */
  onOpen() {
    const { contentEl, modalEl } = this;
    
    // Apply mobile modal classes
    modalEl.addClass('mobile-modal');
    if (this.config.fullscreen) {
      modalEl.addClass('mobile-modal-fullscreen');
    }
    
    // Clear default content
    contentEl.empty();
    
    // Setup modal structure
    this.setupModalStructure();
    this.setupGestures();
    this.setupResponsiveLayout();
    
    // Animate in
    this.animateIn();
  }

  /**
   * Closes the modal with animation
   */
  close() {
    if (this.isClosing) return;
    
    this.isClosing = true;
    this.animateOut(() => {
      super.close();
    });
  }

  /**
   * Sets up the modal structure
   */
  private setupModalStructure(): void {
    const { contentEl } = this;
    
    // Handle for swipe-to-close
    if (this.config.showHandle) {
      const handle = contentEl.createEl('div', { cls: 'mobile-modal-handle' });
      handle.createEl('div', { cls: 'handle-bar' });
    }
    
    // Header
    const header = contentEl.createEl('div', { cls: 'mobile-modal-header' });
    header.createEl('h2', { text: this.title, cls: 'mobile-modal-title' });
    
    // Close button
    const closeBtn = header.createEl('button', { 
      cls: 'mobile-modal-close',
      attr: { 'aria-label': 'Close modal' }
    });
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => this.close();
    
    // Content area
    const content = contentEl.createEl('div', { cls: 'mobile-modal-content' });
    this.renderSections(content);
    
    // Buttons area
    if (this.buttons.length > 0) {
      const buttonsContainer = contentEl.createEl('div', { cls: 'mobile-modal-buttons' });
      this.renderButtons(buttonsContainer);
    }
  }

  /**
   * Renders the modal sections
   */
  private renderSections(container: HTMLElement): void {
    this.sections.forEach((section, index) => {
      const sectionEl = container.createEl('div', { cls: 'mobile-modal-section' });
      
      if (section.title) {
        const titleEl = sectionEl.createEl('div', { cls: 'section-header' });
        const titleText = titleEl.createEl('h3', { text: section.title });
        
        if (section.collapsible) {
          titleEl.addClass('collapsible');
          const toggleIcon = titleEl.createEl('span', { cls: 'toggle-icon' });
          toggleIcon.innerHTML = section.collapsed ? '▶' : '▼';
          
          titleEl.onclick = () => this.toggleSection(index);
          
          if (section.collapsed) {
            sectionEl.addClass('collapsed');
          }
        }
      }
      
      const contentEl = sectionEl.createEl('div', { cls: 'section-content' });
      
      if (typeof section.content === 'string') {
        contentEl.innerHTML = section.content;
      } else {
        contentEl.appendChild(section.content);
      }
    });
  }

  /**
   * Renders the modal buttons
   */
  private renderButtons(container: HTMLElement): void {
    // Determine layout based on button count and screen size
    const isMobile = window.innerWidth < 768;
    const shouldStack = isMobile && this.buttons.length > 2;
    
    if (shouldStack) {
      container.addClass('stacked');
    }
    
    this.buttons.forEach(button => {
      const btnEl = container.createEl('button', {
        text: button.text,
        cls: `mobile-btn mobile-btn-${button.style}`
      });
      
      if (button.icon) {
        btnEl.innerHTML = `<span class="btn-icon">${button.icon}</span> ${button.text}`;
      }
      
      if (button.disabled) {
        btnEl.disabled = true;
        btnEl.addClass('disabled');
      }
      
      btnEl.onclick = async () => {
        if (button.disabled) return;
        
        try {
          btnEl.addClass('loading');
          await button.action();
          
          if (this.config.hapticFeedback) {
            this.triggerHaptic('success');
          }
        } catch (error) {
          console.error('Button action failed:', error);
          
          if (this.config.hapticFeedback) {
            this.triggerHaptic('error');
          }
        } finally {
          btnEl.removeClass('loading');
        }
      };
    });
  }

  /**
   * Sets up gesture handling
   */
  private setupGestures(): void {
    if (!this.config.gestureEnabled || !this.gestureHandler) {
      return;
    }
    
    const { modalEl } = this;
    
    // Swipe to close
    if (this.config.swipeToClose) {
      this.gestureHandler.bindGestures(modalEl, {
        swipe: (event) => {
          if (event.direction === 'down') {
            this.close();
          }
        }
      });
    }
    
    // Manual drag handling for smooth interactions
    this.setupDragHandling();
  }

  /**
   * Sets up manual drag handling for smooth swipe-to-close
   */
  private setupDragHandling(): void {
    const { modalEl } = this;
    
    const handleStart = (e: TouchEvent | MouseEvent) => {
      this.startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      this.isDragging = true;
      modalEl.addClass('dragging');
    };
    
    const handleMove = (e: TouchEvent | MouseEvent) => {
      if (!this.isDragging) return;
      
      const currentY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const deltaY = currentY - this.startY;
      
      // Only allow downward dragging
      if (deltaY > 0) {
        this.currentTranslateY = deltaY;
        modalEl.style.transform = `translateY(${deltaY}px)`;
        
        // Add opacity fade
        const opacity = Math.max(0.3, 1 - (deltaY / window.innerHeight));
        modalEl.style.opacity = opacity.toString();
      }
    };
    
    const handleEnd = () => {
      if (!this.isDragging) return;
      
      this.isDragging = false;
      modalEl.removeClass('dragging');
      
      // Close if dragged down enough
      const threshold = window.innerHeight * 0.25;
      if (this.currentTranslateY > threshold) {
        this.close();
      } else {
        // Snap back
        modalEl.style.transition = `transform ${this.config.animationDuration}ms ease-out, opacity ${this.config.animationDuration}ms ease-out`;
        modalEl.style.transform = 'translateY(0)';
        modalEl.style.opacity = '1';
        
        setTimeout(() => {
          modalEl.style.transition = '';
        }, this.config.animationDuration);
      }
      
      this.currentTranslateY = 0;
    };
    
    // Touch events
    modalEl.addEventListener('touchstart', handleStart, { passive: false });
    modalEl.addEventListener('touchmove', handleMove, { passive: false });
    modalEl.addEventListener('touchend', handleEnd);
    
    // Mouse events for testing
    modalEl.addEventListener('mousedown', handleStart);
    modalEl.addEventListener('mousemove', handleMove);
    modalEl.addEventListener('mouseup', handleEnd);
  }

  /**
   * Sets up responsive layout adjustments
   */
  private setupResponsiveLayout(): void {
    const { modalEl } = this;
    
    const updateLayout = () => {
      const isMobile = window.innerWidth < 768;
      const isLandscape = window.innerWidth > window.innerHeight;
      
      modalEl.toggleClass('mobile-layout', isMobile);
      modalEl.toggleClass('landscape-layout', isLandscape);
      
      // Adjust height for mobile
      if (this.config.adaptiveHeight && isMobile) {
        const vh = window.innerHeight * 0.01;
        modalEl.style.setProperty('--vh', `${vh}px`);
        
        if (this.config.fullscreen) {
          modalEl.style.height = 'calc(var(--vh, 1vh) * 100)';
        } else {
          modalEl.style.maxHeight = 'calc(var(--vh, 1vh) * 90)';
        }
      }
    };
    
    updateLayout();
    window.addEventListener('resize', updateLayout);
    window.addEventListener('orientationchange', () => {
      setTimeout(updateLayout, 100); // Delay to ensure viewport has updated
    });
  }

  /**
   * Toggles a collapsible section
   */
  private toggleSection(index: number): void {
    const section = this.sections[index];
    if (!section.collapsible) return;
    
    section.collapsed = !section.collapsed;
    
    const sectionEl = this.contentEl.querySelectorAll('.mobile-modal-section')[index] as HTMLElement;
    const toggleIcon = sectionEl.querySelector('.toggle-icon') as HTMLElement;
    
    if (section.collapsed) {
      sectionEl.addClass('collapsed');
      toggleIcon.innerHTML = '▶';
    } else {
      sectionEl.removeClass('collapsed');
      toggleIcon.innerHTML = '▼';
    }
    
    if (this.config.hapticFeedback) {
      this.triggerHaptic('selection');
    }
  }

  /**
   * Animates the modal in
   */
  private animateIn(): void {
    const { modalEl } = this;
    
    modalEl.style.opacity = '0';
    modalEl.style.transform = 'translateY(100%)';
    
    requestAnimationFrame(() => {
      modalEl.style.transition = `opacity ${this.config.animationDuration}ms ease-out, transform ${this.config.animationDuration}ms ease-out`;
      modalEl.style.opacity = '1';
      modalEl.style.transform = 'translateY(0)';
    });
  }

  /**
   * Animates the modal out
   */
  private animateOut(callback: () => void): void {
    const { modalEl } = this;
    
    modalEl.style.transition = `opacity ${this.config.animationDuration}ms ease-in, transform ${this.config.animationDuration}ms ease-in`;
    modalEl.style.opacity = '0';
    modalEl.style.transform = 'translateY(100%)';
    
    setTimeout(callback, this.config.animationDuration);
  }

  /**
   * Triggers haptic feedback
   */
  private triggerHaptic(type: 'success' | 'error' | 'warning' | 'selection' | 'impact'): void {
    if (!this.config.hapticFeedback) return;
    
    try {
      if ('vibrate' in navigator) {
        const patterns = {
          success: [100],
          error: [100, 50, 100],
          warning: [200],
          selection: [50],
          impact: [10]
        };
        
        navigator.vibrate(patterns[type]);
      }
    } catch (error) {
      // Ignore haptic feedback errors
    }
  }

  /**
   * Updates button state
   */
  updateButtonState(index: number, updates: Partial<MobileModalButton>): void {
    if (index < 0 || index >= this.buttons.length) return;
    
    this.buttons[index] = { ...this.buttons[index], ...updates };
    
    // Update DOM
    const buttonEls = this.contentEl.querySelectorAll('.mobile-btn');
    const buttonEl = buttonEls[index] as HTMLButtonElement;
    
    if (updates.text) {
      buttonEl.textContent = updates.text;
    }
    
    if (updates.disabled !== undefined) {
      buttonEl.disabled = updates.disabled;
      buttonEl.toggleClass('disabled', updates.disabled);
    }
  }

  /**
   * Adds loading state to a button
   */
  setButtonLoading(index: number, loading: boolean): void {
    if (index < 0 || index >= this.buttons.length) return;
    
    const buttonEls = this.contentEl.querySelectorAll('.mobile-btn');
    const buttonEl = buttonEls[index] as HTMLButtonElement;
    
    buttonEl.toggleClass('loading', loading);
    buttonEl.disabled = loading;
  }

  /**
   * Shows a temporary success message
   */
  showSuccess(message: string, duration: number = 3000): void {
    const successEl = this.contentEl.createEl('div', {
      cls: 'mobile-modal-success',
      text: message
    });
    
    setTimeout(() => {
      successEl.remove();
    }, duration);
    
    if (this.config.hapticFeedback) {
      this.triggerHaptic('success');
    }
  }

  /**
   * Shows a temporary error message
   */
  showError(message: string, duration: number = 5000): void {
    const errorEl = this.contentEl.createEl('div', {
      cls: 'mobile-modal-error',
      text: message
    });
    
    setTimeout(() => {
      errorEl.remove();
    }, duration);
    
    if (this.config.hapticFeedback) {
      this.triggerHaptic('error');
    }
  }

  /**
   * Creates a progress indicator
   */
  showProgress(current: number, total: number, message?: string): void {
    let progressContainer = this.contentEl.querySelector('.mobile-modal-progress') as HTMLElement;
    
    if (!progressContainer) {
      progressContainer = this.contentEl.createEl('div', { cls: 'mobile-modal-progress' });
    }
    
    progressContainer.empty();
    
    if (message) {
      progressContainer.createEl('div', { cls: 'progress-message', text: message });
    }
    
    const progressBar = progressContainer.createEl('div', { cls: 'progress-bar' });
    const progressFill = progressBar.createEl('div', { cls: 'progress-fill' });
    
    const percentage = Math.round((current / total) * 100);
    progressFill.style.width = `${percentage}%`;
    
    const progressText = progressContainer.createEl('div', { 
      cls: 'progress-text',
      text: `${current}/${total} (${percentage}%)`
    });
  }

  /**
   * Hides the progress indicator
   */
  hideProgress(): void {
    const progressContainer = this.contentEl.querySelector('.mobile-modal-progress');
    if (progressContainer) {
      progressContainer.remove();
    }
  }
}

/**
 * Utility function to create a simple mobile modal
 */
export function createMobileModal(
  app: App,
  title: string,
  content: string | HTMLElement,
  buttons: MobileModalButton[],
  config?: Partial<MobileModalConfig>
): MobileModal {
  const modal = new MobileModal(app, title, config);
  
  modal.addSection({
    content: content
  });
  
  buttons.forEach(button => modal.addButton(button));
  
  return modal;
}

/**
 * Utility function to create a confirmation modal
 */
export function createConfirmationModal(
  app: App,
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  onCancel?: () => void
): MobileModal {
  const modal = new MobileModal(app, title, {
    swipeToClose: true,
    tapBackdropToClose: true
  });
  
  modal.addSection({
    content: message
  });
  
  modal.addButton({
    text: 'Cancel',
    style: 'secondary',
    action: () => {
      if (onCancel) onCancel();
      modal.close();
    }
  });
  
  modal.addButton({
    text: 'Confirm',
    style: 'primary',
    action: async () => {
      await onConfirm();
      modal.close();
    }
  });
  
  return modal;
}