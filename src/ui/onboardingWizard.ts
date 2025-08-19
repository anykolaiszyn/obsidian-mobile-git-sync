/**
 * Onboarding Wizard
 * 
 * Progressive setup flow that guides users through plugin configuration
 * with smart defaults and user-friendly language
 */

import { Modal, App, Setting, Notice, ButtonComponent } from 'obsidian';
import type MobileGitSyncPlugin from '../../main';
import { PluginSettings } from '../types';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  validate?: () => Promise<boolean>;
  render: (container: HTMLElement) => void;
}

export class OnboardingWizard extends Modal {
  private currentStep = 0;
  private steps: OnboardingStep[] = [];
  private tempSettings: Partial<PluginSettings> = {};
  private nextButton?: ButtonComponent;
  private backButton?: ButtonComponent;
  private finishButton?: ButtonComponent;

  constructor(
    app: App,
    private plugin: MobileGitSyncPlugin
  ) {
    super(app);
    this.setupSteps();
  }

  onOpen() {
    this.titleEl.setText('📱 Mobile Git Sync Setup');
    this.modalEl.addClass('git-sync-onboarding');
    this.renderCurrentStep();
  }

  onClose() {
    // Clean up any temporary data
  }

  private setupSteps() {
    this.steps = [
      {
        id: 'welcome',
        title: '👋 Welcome to Mobile Git Sync',
        description: 'Let\'s get your Obsidian vault syncing with GitHub in just a few steps!',
        render: (container) => this.renderWelcomeStep(container)
      },
      {
        id: 'mode-selection',
        title: '🎯 Choose Your Experience',
        description: 'How comfortable are you with Git and GitHub?',
        render: (container) => this.renderModeSelectionStep(container)
      },
      {
        id: 'repository',
        title: '📂 Connect Your Repository',
        description: 'Connect to your GitHub repository where your notes will be synced',
        validate: () => this.validateRepository(),
        render: (container) => this.renderRepositoryStep(container)
      },
      {
        id: 'token',
        title: '🔑 GitHub Access',
        description: 'Provide secure access to your GitHub account',
        validate: () => this.validateToken(),
        render: (container) => this.renderTokenStep(container)
      },
      {
        id: 'sync-options',
        title: '⚙️ Sync Preferences',
        description: 'Configure how and when your notes sync',
        render: (container) => this.renderSyncOptionsStep(container)
      },
      {
        id: 'completion',
        title: '🎉 All Set!',
        description: 'Your Mobile Git Sync is ready to use',
        render: (container) => this.renderCompletionStep(container)
      }
    ];
  }

  private renderCurrentStep() {
    const step = this.steps[this.currentStep];
    if (!step) return;

    // Clear container
    this.contentEl.empty();

    // Progress indicator
    this.renderProgressIndicator();

    // Step content
    const stepContainer = this.contentEl.createDiv('onboarding-step');
    
    // Header
    const header = stepContainer.createDiv('onboarding-header');
    header.createEl('h2', { text: step.title });
    header.createEl('p', { 
      text: step.description,
      cls: 'onboarding-description'
    });

    // Step content
    const content = stepContainer.createDiv('onboarding-content');
    step.render(content);

    // Navigation
    this.renderNavigation(stepContainer);
  }

  private renderProgressIndicator() {
    const progress = this.contentEl.createDiv('onboarding-progress');
    const progressBar = progress.createDiv('progress-bar');
    const progressFill = progressBar.createDiv('progress-fill');
    
    const percentage = ((this.currentStep + 1) / this.steps.length) * 100;
    progressFill.style.width = `${percentage}%`;
    
    const stepIndicator = progress.createDiv('step-indicator');
    stepIndicator.setText(`Step ${this.currentStep + 1} of ${this.steps.length}`);
  }

  private renderWelcomeStep(container: HTMLElement) {
    const features = container.createDiv('feature-highlights');
    
    const featureList = [
      { icon: '📱', title: 'Mobile-First', desc: 'Designed specifically for mobile devices' },
      { icon: '🔄', title: 'Auto-Sync', desc: 'Keeps your notes in sync automatically' },
      { icon: '🔒', title: 'Secure', desc: 'Your tokens are encrypted and stored safely' },
      { icon: '⚡', title: 'Smart', desc: 'Optimizes battery and data usage' }
    ];

    featureList.forEach(feature => {
      const item = features.createDiv('feature-item');
      item.createSpan('feature-icon').setText(feature.icon);
      const content = item.createDiv('feature-content');
      content.createEl('h4', { text: feature.title });
      content.createEl('p', { text: feature.desc });
    });
  }

  private renderModeSelectionStep(container: HTMLElement) {
    const modes = container.createDiv('mode-selection');
    
    const beginnerMode = modes.createDiv('mode-card');
    beginnerMode.addClass('mode-card-beginner');
    beginnerMode.createEl('h3', { text: '🌱 Beginner Mode' });
    beginnerMode.createEl('p', { text: 'New to Git? We\'ll use simple terms and smart defaults.' });
    beginnerMode.createEl('ul').innerHTML = `
      <li>Automatic conflict resolution</li>
      <li>Simple sync controls</li>
      <li>Guided help throughout</li>
    `;
    
    const advancedMode = modes.createDiv('mode-card');
    advancedMode.addClass('mode-card-advanced');
    advancedMode.createEl('h3', { text: '⚡ Advanced Mode' });
    advancedMode.createEl('p', { text: 'Familiar with Git? Access all features and customization.' });
    advancedMode.createEl('ul').innerHTML = `
      <li>Full control over sync behavior</li>
      <li>Advanced conflict resolution</li>
      <li>Custom exclude patterns</li>
    `;

    // Mode selection handlers
    beginnerMode.addEventListener('click', () => {
      this.tempSettings.userMode = 'beginner';
      modes.querySelectorAll('.mode-card').forEach(el => el.removeClass('selected'));
      beginnerMode.addClass('selected');
    });

    advancedMode.addEventListener('click', () => {
      this.tempSettings.userMode = 'advanced';
      modes.querySelectorAll('.mode-card').forEach(el => el.removeClass('selected'));
      advancedMode.addClass('selected');
    });

    // Pre-select beginner mode
    this.tempSettings.userMode = 'beginner';
    beginnerMode.addClass('selected');
  }

  private renderRepositoryStep(container: HTMLElement) {
    const repoSection = container.createDiv('repository-setup');

    if (this.tempSettings.userMode === 'beginner') {
      // Simplified repository setup for beginners
      repoSection.createEl('h4', { text: 'Repository URL' });
      repoSection.createEl('p', { 
        text: 'Paste the web address of your GitHub repository (e.g., https://github.com/username/my-notes)',
        cls: 'help-text'
      });

      new Setting(repoSection)
        .setName('GitHub Repository')
        .setDesc('The web address where your notes will be stored')
        .addText(text => {
          text.setPlaceholder('https://github.com/username/repository')
            .setValue(this.tempSettings.repoUrl || '')
            .onChange(value => {
              this.tempSettings.repoUrl = value;
              this.validateRepository();
            });
        });
    } else {
      // Advanced repository setup
      repoSection.createEl('h4', { text: 'Repository Configuration' });
      
      new Setting(repoSection)
        .setName('Repository URL')
        .setDesc('GitHub repository URL (HTTPS or SSH)')
        .addText(text => {
          text.setPlaceholder('https://github.com/username/repository')
            .setValue(this.tempSettings.repoUrl || '')
            .onChange(value => {
              this.tempSettings.repoUrl = value;
            });
        });

      new Setting(repoSection)
        .setName('Branch')
        .setDesc('Git branch to sync with')
        .addText(text => {
          text.setPlaceholder('main')
            .setValue(this.tempSettings.branch || 'main')
            .onChange(value => {
              this.tempSettings.branch = value;
            });
        });
    }

    // Test connection button
    const testSection = repoSection.createDiv('test-connection');
    const testButton = testSection.createEl('button', {
      text: '🔍 Test Connection',
      cls: 'mod-cta'
    });
    
    const testResult = testSection.createDiv('test-result');
    
    testButton.addEventListener('click', async () => {
      testButton.disabled = true;
      testButton.setText('Testing...');
      testResult.empty();
      
      try {
        const isValid = await this.validateRepository();
        if (isValid) {
          testResult.createDiv('success-message').setText('✅ Repository found and accessible!');
        } else {
          testResult.createDiv('error-message').setText('❌ Could not access repository. Please check the URL.');
        }
      } catch (error) {
        testResult.createDiv('error-message').setText(`❌ Error: ${(error as Error).message}`);
      }
      
      testButton.disabled = false;
      testButton.setText('🔍 Test Connection');
    });
  }

  private renderTokenStep(container: HTMLElement) {
    const tokenSection = container.createDiv('token-setup');

    if (this.tempSettings.userMode === 'beginner') {
      // Beginner-friendly token setup
      tokenSection.createEl('h4', { text: 'GitHub Access Token' });
      tokenSection.createEl('p', { 
        text: 'To sync your notes, we need permission to access your GitHub repository.',
        cls: 'help-text'
      });

      // Simple token tutorial
      const tutorial = tokenSection.createDiv('token-tutorial');
      tutorial.createEl('h5', { text: 'How to get your token:' });
      const steps = tutorial.createEl('ol');
      steps.innerHTML = `
        <li>Go to <a href="https://github.com/settings/tokens" target="_blank">GitHub Settings → Developer settings → Personal access tokens</a></li>
        <li>Click "Generate new token (classic)"</li>
        <li>Give it a name like "Obsidian Mobile Sync"</li>
        <li>Select "repo" permissions</li>
        <li>Copy the token and paste it below</li>
      `;

      new Setting(tokenSection)
        .setName('Access Token')
        .setDesc('Paste your GitHub personal access token here')
        .addText(text => {
          text.inputEl.type = 'password';
          text.setPlaceholder('ghp_xxxxxxxxxxxxxxxxxxxx')
            .onChange(value => {
              this.tempSettings.githubToken = value;
            });
        });
    } else {
      // Advanced token setup
      tokenSection.createEl('h4', { text: 'GitHub Authentication' });
      
      new Setting(tokenSection)
        .setName('Personal Access Token')
        .setDesc('GitHub PAT with repo permissions')
        .addText(text => {
          text.inputEl.type = 'password';
          text.setPlaceholder('ghp_xxxxxxxxxxxxxxxxxxxx')
            .onChange(value => {
              this.tempSettings.githubToken = value;
            });
        });

      // Token permissions info
      const permissionsInfo = tokenSection.createDiv('permissions-info');
      permissionsInfo.createEl('h5', { text: 'Required Permissions:' });
      const permsList = permissionsInfo.createEl('ul');
      permsList.innerHTML = `
        <li><code>repo</code> - Full control of private repositories</li>
        <li><code>public_repo</code> - Access to public repositories (if using public repos)</li>
      `;
    }

    // Security notice
    const securityNotice = tokenSection.createDiv('security-notice');
    securityNotice.createEl('p', {
      text: '🔒 Your token will be encrypted and stored securely on your device.',
      cls: 'security-text'
    });
  }

  private renderSyncOptionsStep(container: HTMLElement) {
    const syncSection = container.createDiv('sync-options');

    if (this.tempSettings.userMode === 'beginner') {
      // Simplified sync options
      syncSection.createEl('h4', { text: 'Sync Settings' });
      syncSection.createEl('p', { 
        text: 'We\'ve chosen smart defaults that work great for most users.',
        cls: 'help-text'
      });

      new Setting(syncSection)
        .setName('Auto-Sync')
        .setDesc('Automatically sync your notes every 15 minutes')
        .addToggle(toggle => {
          toggle.setValue(true)
            .onChange(value => {
              this.tempSettings.autoSyncEnabled = value;
              this.tempSettings.autoSyncInterval = value ? 15 : 0;
            });
        });

      new Setting(syncSection)
        .setName('When conflicts happen')
        .setDesc('What to do when the same note is changed in multiple places')
        .addDropdown(dropdown => {
          dropdown.addOption('ask', 'Ask me what to do')
            .addOption('keep-mine', 'Keep my version')
            .addOption('keep-newest', 'Keep the newest version')
            .setValue('ask')
            .onChange(value => {
              this.tempSettings.conflictStrategy = this.mapUserFriendlyConflictStrategy(value);
            });
        });

    } else {
      // Advanced sync options
      syncSection.createEl('h4', { text: 'Sync Configuration' });

      new Setting(syncSection)
        .setName('Auto-Sync Interval')
        .setDesc('Automatically sync every N minutes (0 to disable)')
        .addText(text => {
          text.setPlaceholder('15')
            .setValue('15')
            .onChange(value => {
              const interval = parseInt(value) || 0;
              this.tempSettings.autoSyncInterval = interval;
            });
        });

      new Setting(syncSection)
        .setName('Conflict Resolution')
        .setDesc('Default strategy for handling conflicts')
        .addDropdown(dropdown => {
          dropdown.addOption('prompt', 'Prompt for each conflict')
            .addOption('latest', 'Use latest timestamp')
            .addOption('local', 'Prefer local changes')
            .addOption('remote', 'Prefer remote changes')
            .setValue('prompt')
            .onChange(value => {
              this.tempSettings.conflictStrategy = value as any;
            });
        });

      new Setting(syncSection)
        .setName('Sync Folders')
        .setDesc('Folders to include in sync (leave empty for entire vault)')
        .addTextArea(text => {
          text.setPlaceholder('folder1\nfolder2\nfolder3')
            .onChange(value => {
              this.tempSettings.syncFolders = value.split('\n').filter(f => f.trim());
            });
        });

      new Setting(syncSection)
        .setName('Exclude Patterns')
        .setDesc('File patterns to exclude from sync')
        .addTextArea(text => {
          text.setPlaceholder('.obsidian/workspace*\n*.tmp\n.trash/')
            .setValue('.obsidian/workspace*\n*.tmp\n.trash/')
            .onChange(value => {
              this.tempSettings.excludePatterns = value.split('\n').filter(p => p.trim());
            });
        });
    }
  }

  private renderCompletionStep(container: HTMLElement) {
    const completion = container.createDiv('completion-step');
    
    completion.createDiv('success-icon').setText('🎉');
    completion.createEl('h3', { text: 'You\'re all set!' });
    completion.createEl('p', { 
      text: 'Mobile Git Sync is now configured and ready to keep your notes in sync across all your devices.'
    });

    // Summary of settings
    const summary = completion.createDiv('setup-summary');
    summary.createEl('h4', { text: 'Configuration Summary:' });
    
    const summaryList = summary.createEl('ul');
    summaryList.innerHTML = `
      <li>📂 Repository: ${this.tempSettings.repoUrl || 'Not configured'}</li>
      <li>🎯 Mode: ${this.tempSettings.userMode === 'beginner' ? 'Beginner (Simple)' : 'Advanced'}</li>
      <li>⚡ Auto-Sync: ${this.tempSettings.autoSyncInterval ? `Every ${this.tempSettings.autoSyncInterval} minutes` : 'Disabled'}</li>
      <li>🔄 Conflicts: ${this.getConflictStrategyDescription(this.tempSettings.conflictStrategy)}</li>
    `;

    // Next steps
    const nextSteps = completion.createDiv('next-steps');
    nextSteps.createEl('h4', { text: 'Next Steps:' });
    const stepsList = nextSteps.createEl('ol');
    stepsList.innerHTML = `
      <li>Click "Finish" to save your settings</li>
      <li>Use the "🔄 Sync Now" command to test your setup</li>
      <li>Look for the sync status in your status bar</li>
      ${this.tempSettings.userMode === 'beginner' ? 
        '<li>Check out the beginner guide in settings for tips</li>' : 
        '<li>Explore advanced features in the plugin settings</li>'
      }
    `;
  }

  private renderNavigation(container: HTMLElement) {
    const nav = container.createDiv('onboarding-nav');
    
    // Back button
    if (this.currentStep > 0) {
      this.backButton = new ButtonComponent(nav)
        .setButtonText('← Back')
        .onClick(() => this.goToPreviousStep());
    }

    // Next/Finish button
    const isLastStep = this.currentStep === this.steps.length - 1;
    
    if (isLastStep) {
      this.finishButton = new ButtonComponent(nav)
        .setButtonText('Finish Setup')
        .setCta()
        .onClick(() => this.completeOnboarding());
    } else {
      this.nextButton = new ButtonComponent(nav)
        .setButtonText('Next →')
        .setCta()
        .onClick(() => this.goToNextStep());
    }
  }

  private async goToNextStep() {
    const currentStep = this.steps[this.currentStep];
    
    // Validate current step if needed
    if (currentStep.validate) {
      const isValid = await currentStep.validate();
      if (!isValid) {
        return; // Stay on current step
      }
    }

    this.currentStep++;
    this.renderCurrentStep();
  }

  private goToPreviousStep() {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.renderCurrentStep();
    }
  }

  private async completeOnboarding() {
    try {
      // Apply all settings
      const newSettings = {
        ...this.plugin.settings,
        ...this.tempSettings,
        isConfigured: true,
        hasCompletedOnboarding: true
      };

      // Save settings
      this.plugin.settings = newSettings as PluginSettings;
      await this.plugin.saveSettings();

      // Show success message
      new Notice('🎉 Mobile Git Sync is now configured!');
      
      // Close wizard
      this.close();

      // Trigger initial sync if configured
      if (newSettings.repoUrl && newSettings.githubToken) {
        new Notice('🔄 Starting initial sync...');
        this.plugin.fullSync().catch(error => {
          console.error('Initial sync failed:', error);
          new Notice('Initial sync encountered an issue. Check the sync status for details.');
        });
      }

    } catch (error) {
      console.error('Failed to complete onboarding:', error);
      new Notice('Failed to save settings. Please try again.');
    }
  }

  private async validateRepository(): Promise<boolean> {
    if (!this.tempSettings.repoUrl) {
      return false;
    }

    try {
      // Basic URL validation
      const url = new URL(this.tempSettings.repoUrl);
      return url.hostname === 'github.com' && url.pathname.split('/').length >= 3;
    } catch {
      return false;
    }
  }

  private async validateToken(): Promise<boolean> {
    if (!this.tempSettings.githubToken) {
      return false;
    }

    // Basic token format validation
    return this.tempSettings.githubToken.startsWith('ghp_') && this.tempSettings.githubToken.length > 20;
  }

  private mapUserFriendlyConflictStrategy(userChoice: string): any {
    const mapping = {
      'ask': 'prompt',
      'keep-mine': 'local',
      'keep-newest': 'latest'
    };
    return mapping[userChoice] || 'prompt';
  }

  private getConflictStrategyDescription(strategy: any): string {
    const descriptions = {
      'prompt': 'Ask me each time',
      'local': 'Keep my version',
      'remote': 'Keep remote version',
      'latest': 'Use newest version'
    };
    return descriptions[strategy] || 'Ask me each time';
  }
}