/**
 * Comprehensive Analytics Dashboard
 * 
 * Provides detailed insights into sync performance, usage patterns,
 * and system health with interactive visualizations
 */

import { Modal, App, Setting } from 'obsidian';
import { Logger } from '../utils/logger';

export interface AnalyticsData {
  syncMetrics: SyncMetrics;
  performanceMetrics: PerformanceMetrics;
  usageMetrics: UsageMetrics;
  errorMetrics: ErrorMetrics;
  systemMetrics: SystemMetrics;
}

export interface SyncMetrics {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  averageDuration: number;
  totalDataTransferred: number;
  conflictsResolved: number;
  syncsByTimeOfDay: Record<string, number>;
  syncsByDayOfWeek: Record<string, number>;
  filesProcessed: number;
  averageFileSize: number;
}

export interface PerformanceMetrics {
  averageLatency: number;
  throughput: number; // bytes per second
  memoryUsage: {
    average: number;
    peak: number;
    current: number;
  };
  cacheHitRate: number;
  networkEfficiency: number;
  batteryImpact: number;
}

export interface UsageMetrics {
  activeUsers: number;
  sessionsPerUser: number;
  averageSessionDuration: number;
  featureUsage: Record<string, number>;
  deviceTypes: Record<string, number>;
  networkTypes: Record<string, number>;
  peakUsageHours: number[];
}

export interface ErrorMetrics {
  totalErrors: number;
  errorsByType: Record<string, number>;
  errorsByComponent: Record<string, number>;
  errorRate: number;
  meanTimeToResolution: number;
  criticalErrors: number;
  recentErrors: Array<{
    timestamp: number;
    type: string;
    message: string;
    component: string;
  }>;
}

export interface SystemMetrics {
  uptime: number;
  availability: number;
  resourceUtilization: {
    cpu: number;
    memory: number;
    storage: number;
    network: number;
  };
  healthScore: number;
  alerts: SystemAlert[];
}

export interface SystemAlert {
  id: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  description: string;
  timestamp: number;
  resolved: boolean;
}

export interface ChartConfig {
  type: 'line' | 'bar' | 'pie' | 'area' | 'gauge';
  title: string;
  width: number;
  height: number;
  data: ChartDataPoint[];
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
}

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
  metadata?: any;
}

export class AnalyticsDashboard extends Modal {
  private data: AnalyticsData;
  private refreshInterval: NodeJS.Timeout | null = null;
  private charts = new Map<string, HTMLCanvasElement>();

  constructor(
    app: App,
    private logger: Logger,
    private dataProvider: () => Promise<AnalyticsData>
  ) {
    super(app);
    this.data = this.getEmptyData();
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('analytics-dashboard');

    // Load initial data
    await this.refreshData();
    
    // Create dashboard layout
    this.createHeader();
    this.createOverviewCards();
    this.createChartSections();
    this.createDetailTables();
    this.createSystemAlerts();
    
    // Start auto-refresh
    this.startAutoRefresh();
  }

  onClose() {
    this.stopAutoRefresh();
  }

  /**
   * Creates the dashboard header with controls
   */
  private createHeader(): void {
    const header = this.contentEl.createEl('div', { cls: 'dashboard-header' });
    
    header.createEl('h1', { text: 'Git Sync Analytics Dashboard' });
    
    const controls = header.createEl('div', { cls: 'dashboard-controls' });
    
    // Refresh button
    const refreshBtn = controls.createEl('button', { 
      text: 'Refresh',
      cls: 'dashboard-btn primary'
    });
    refreshBtn.onclick = () => this.refreshData();
    
    // Export button
    const exportBtn = controls.createEl('button', { 
      text: 'Export Data',
      cls: 'dashboard-btn secondary'
    });
    exportBtn.onclick = () => this.exportData();
    
    // Time range selector
    const timeRangeSelect = controls.createEl('select', { cls: 'time-range-select' });
    timeRangeSelect.innerHTML = `
      <option value="1h">Last Hour</option>
      <option value="24h" selected>Last 24 Hours</option>
      <option value="7d">Last 7 Days</option>
      <option value="30d">Last 30 Days</option>
    `;
    
    // Last updated indicator
    const lastUpdated = header.createEl('div', { cls: 'last-updated' });
    lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  }

  /**
   * Creates overview metric cards
   */
  private createOverviewCards(): void {
    const overview = this.contentEl.createEl('div', { cls: 'overview-section' });
    
    const cards = [
      {
        title: 'Total Syncs',
        value: this.data.syncMetrics.totalSyncs.toLocaleString(),
        change: this.calculateChangePercentage('totalSyncs'),
        icon: '🔄'
      },
      {
        title: 'Success Rate',
        value: this.calculateSuccessRate() + '%',
        change: this.calculateChangePercentage('successRate'),
        icon: '✅'
      },
      {
        title: 'Avg Duration',
        value: this.formatDuration(this.data.syncMetrics.averageDuration),
        change: this.calculateChangePercentage('avgDuration'),
        icon: '⏱️'
      },
      {
        title: 'Data Transferred',
        value: this.formatBytes(this.data.syncMetrics.totalDataTransferred),
        change: this.calculateChangePercentage('dataTransferred'),
        icon: '📊'
      },
      {
        title: 'System Health',
        value: this.data.systemMetrics.healthScore + '/100',
        change: this.calculateChangePercentage('healthScore'),
        icon: '❤️'
      },
      {
        title: 'Active Alerts',
        value: this.data.systemMetrics.alerts.filter(a => !a.resolved).length.toString(),
        change: 0,
        icon: '⚠️'
      }
    ];

    cards.forEach(card => {
      const cardEl = overview.createEl('div', { cls: 'metric-card' });
      
      cardEl.createEl('div', { cls: 'metric-icon', text: card.icon });
      
      const content = cardEl.createEl('div', { cls: 'metric-content' });
      content.createEl('div', { cls: 'metric-title', text: card.title });
      content.createEl('div', { cls: 'metric-value', text: card.value });
      
      if (card.change !== 0) {
        const changeEl = content.createEl('div', { 
          cls: `metric-change ${card.change > 0 ? 'positive' : 'negative'}`
        });
        changeEl.textContent = `${card.change > 0 ? '+' : ''}${card.change.toFixed(1)}%`;
      }
    });
  }

  /**
   * Creates chart sections
   */
  private createChartSections(): void {
    const chartsContainer = this.contentEl.createEl('div', { cls: 'charts-container' });
    
    // Sync trends chart
    this.createChart(chartsContainer, {
      type: 'line',
      title: 'Sync Activity Over Time',
      width: 600,
      height: 300,
      data: this.prepareSyncTrendData(),
      showGrid: true,
      showLegend: true
    });
    
    // Performance metrics chart
    this.createChart(chartsContainer, {
      type: 'area',
      title: 'Performance Metrics',
      width: 600,
      height: 300,
      data: this.preparePerformanceData(),
      colors: ['#3b82f6', '#10b981', '#f59e0b'],
      showGrid: true
    });
    
    // Error distribution pie chart
    this.createChart(chartsContainer, {
      type: 'pie',
      title: 'Error Distribution',
      width: 400,
      height: 300,
      data: this.prepareErrorDistributionData(),
      showLegend: true
    });
    
    // Network types usage
    this.createChart(chartsContainer, {
      type: 'bar',
      title: 'Network Types Usage',
      width: 400,
      height: 300,
      data: this.prepareNetworkUsageData(),
      colors: ['#8b5cf6', '#ec4899', '#06b6d4']
    });
  }

  /**
   * Creates a chart with the given configuration
   */
  private createChart(container: HTMLElement, config: ChartConfig): void {
    const chartContainer = container.createEl('div', { cls: 'chart-container' });
    chartContainer.createEl('h3', { text: config.title, cls: 'chart-title' });
    
    const canvas = chartContainer.createEl('canvas', { cls: 'chart-canvas' });
    canvas.width = config.width;
    canvas.height = config.height;
    
    this.charts.set(config.title, canvas);
    this.renderChart(canvas, config);
  }

  /**
   * Renders a chart on the given canvas
   */
  private renderChart(canvas: HTMLCanvasElement, config: ChartConfig): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    switch (config.type) {
      case 'line':
        this.renderLineChart(ctx, config);
        break;
      case 'bar':
        this.renderBarChart(ctx, config);
        break;
      case 'pie':
        this.renderPieChart(ctx, config);
        break;
      case 'area':
        this.renderAreaChart(ctx, config);
        break;
      case 'gauge':
        this.renderGaugeChart(ctx, config);
        break;
    }
  }

  /**
   * Creates detail tables
   */
  private createDetailTables(): void {
    const tablesContainer = this.contentEl.createEl('div', { cls: 'tables-container' });
    
    // Recent sync operations table
    this.createRecentSyncsTable(tablesContainer);
    
    // Top errors table
    this.createTopErrorsTable(tablesContainer);
    
    // System resources table
    this.createSystemResourcesTable(tablesContainer);
  }

  /**
   * Creates recent syncs table
   */
  private createRecentSyncsTable(container: HTMLElement): void {
    const section = container.createEl('div', { cls: 'table-section' });
    section.createEl('h3', { text: 'Recent Sync Operations' });
    
    const table = section.createEl('table', { cls: 'data-table' });
    
    // Header
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    ['Time', 'Duration', 'Files', 'Status', 'Data'].forEach(header => {
      headerRow.createEl('th', { text: header });
    });
    
    // Body (mock data for now)
    const tbody = table.createEl('tbody');
    for (let i = 0; i < 10; i++) {
      const row = tbody.createEl('tr');
      row.createEl('td', { text: new Date(Date.now() - i * 300000).toLocaleTimeString() });
      row.createEl('td', { text: `${(Math.random() * 5 + 1).toFixed(1)}s` });
      row.createEl('td', { text: Math.floor(Math.random() * 20 + 1).toString() });
      
      const status = Math.random() > 0.1 ? 'Success' : 'Failed';
      const statusCell = row.createEl('td', { text: status });
      statusCell.addClass(status.toLowerCase());
      
      row.createEl('td', { text: this.formatBytes(Math.random() * 1024 * 1024) });
    }
  }

  /**
   * Creates top errors table
   */
  private createTopErrorsTable(container: HTMLElement): void {
    const section = container.createEl('div', { cls: 'table-section' });
    section.createEl('h3', { text: 'Top Errors' });
    
    const table = section.createEl('table', { cls: 'data-table' });
    
    // Header
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    ['Error Type', 'Count', 'Last Seen', 'Component'].forEach(header => {
      headerRow.createEl('th', { text: header });
    });
    
    // Body
    const tbody = table.createEl('tbody');
    Object.entries(this.data.errorMetrics.errorsByType)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .forEach(([errorType, count]) => {
        const row = tbody.createEl('tr');
        row.createEl('td', { text: errorType });
        row.createEl('td', { text: count.toString() });
        row.createEl('td', { text: new Date(Date.now() - Math.random() * 86400000).toLocaleString() });
        row.createEl('td', { text: 'SyncService' }); // Mock component
      });
  }

  /**
   * Creates system resources table
   */
  private createSystemResourcesTable(container: HTMLElement): void {
    const section = container.createEl('div', { cls: 'table-section' });
    section.createEl('h3', { text: 'System Resources' });
    
    const resources = [
      { name: 'CPU Usage', value: this.data.systemMetrics.resourceUtilization.cpu, unit: '%' },
      { name: 'Memory Usage', value: this.data.systemMetrics.resourceUtilization.memory, unit: '%' },
      { name: 'Storage Usage', value: this.data.systemMetrics.resourceUtilization.storage, unit: '%' },
      { name: 'Network Usage', value: this.data.systemMetrics.resourceUtilization.network, unit: '%' },
      { name: 'Cache Hit Rate', value: this.data.performanceMetrics.cacheHitRate, unit: '%' },
      { name: 'Average Latency', value: this.data.performanceMetrics.averageLatency, unit: 'ms' }
    ];

    const table = section.createEl('table', { cls: 'data-table' });
    
    resources.forEach(resource => {
      const row = table.createEl('tr');
      row.createEl('td', { text: resource.name });
      
      const valueCell = row.createEl('td');
      const value = resource.value.toFixed(1);
      valueCell.textContent = `${value}${resource.unit}`;
      
      // Add status indicator
      const status = resource.value > 80 ? 'critical' : resource.value > 60 ? 'warning' : 'good';
      valueCell.addClass(`status-${status}`);
    });
  }

  /**
   * Creates system alerts section
   */
  private createSystemAlerts(): void {
    const alertsSection = this.contentEl.createEl('div', { cls: 'alerts-section' });
    alertsSection.createEl('h3', { text: 'System Alerts' });
    
    const activeAlerts = this.data.systemMetrics.alerts.filter(alert => !alert.resolved);
    
    if (activeAlerts.length === 0) {
      alertsSection.createEl('div', { 
        text: 'No active alerts', 
        cls: 'no-alerts' 
      });
      return;
    }

    activeAlerts.forEach(alert => {
      const alertEl = alertsSection.createEl('div', { cls: `alert alert-${alert.level}` });
      
      alertEl.createEl('div', { cls: 'alert-icon', text: this.getAlertIcon(alert.level) });
      
      const content = alertEl.createEl('div', { cls: 'alert-content' });
      content.createEl('div', { cls: 'alert-title', text: alert.title });
      content.createEl('div', { cls: 'alert-description', text: alert.description });
      content.createEl('div', { 
        cls: 'alert-timestamp',
        text: new Date(alert.timestamp).toLocaleString()
      });
    });
  }

  /**
   * Chart rendering methods
   */
  private renderLineChart(ctx: CanvasRenderingContext2D, config: ChartConfig): void {
    const { width, height, data } = config;
    const padding = 50;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    if (data.length === 0) return;

    const maxValue = Math.max(...data.map(d => d.value));
    const minValue = Math.min(...data.map(d => d.value));
    const valueRange = maxValue - minValue || 1;

    // Draw grid
    if (config.showGrid) {
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      
      for (let i = 0; i <= 5; i++) {
        const y = padding + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
      }
    }

    // Draw line
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();

    data.forEach((point, index) => {
      const x = padding + (chartWidth / (data.length - 1)) * index;
      const y = padding + chartHeight - ((point.value - minValue) / valueRange) * chartHeight;
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Draw points
    ctx.fillStyle = '#3b82f6';
    data.forEach((point, index) => {
      const x = padding + (chartWidth / (data.length - 1)) * index;
      const y = padding + chartHeight - ((point.value - minValue) / valueRange) * chartHeight;
      
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fill();
    });
  }

  private renderBarChart(ctx: CanvasRenderingContext2D, config: ChartConfig): void {
    const { width, height, data, colors = ['#3b82f6'] } = config;
    const padding = 50;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    if (data.length === 0) return;

    const maxValue = Math.max(...data.map(d => d.value));
    const barWidth = chartWidth / data.length * 0.8;
    const barSpacing = chartWidth / data.length * 0.2;

    data.forEach((point, index) => {
      const barHeight = (point.value / maxValue) * chartHeight;
      const x = padding + index * (barWidth + barSpacing) + barSpacing / 2;
      const y = height - padding - barHeight;

      ctx.fillStyle = point.color || colors[index % colors.length];
      ctx.fillRect(x, y, barWidth, barHeight);

      // Draw value labels
      ctx.fillStyle = '#374151';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(point.value.toString(), x + barWidth / 2, y - 5);
      ctx.fillText(point.label, x + barWidth / 2, height - padding + 20);
    });
  }

  private renderPieChart(ctx: CanvasRenderingContext2D, config: ChartConfig): void {
    const { width, height, data, colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'] } = config;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 50;

    const total = data.reduce((sum, point) => sum + point.value, 0);
    let currentAngle = -Math.PI / 2;

    data.forEach((point, index) => {
      const sliceAngle = (point.value / total) * 2 * Math.PI;
      
      ctx.fillStyle = point.color || colors[index % colors.length];
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
      ctx.closePath();
      ctx.fill();

      // Draw labels
      const labelAngle = currentAngle + sliceAngle / 2;
      const labelX = centerX + Math.cos(labelAngle) * (radius + 20);
      const labelY = centerY + Math.sin(labelAngle) * (radius + 20);
      
      ctx.fillStyle = '#374151';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`${point.label} (${((point.value / total) * 100).toFixed(1)}%)`, labelX, labelY);

      currentAngle += sliceAngle;
    });
  }

  private renderAreaChart(ctx: CanvasRenderingContext2D, config: ChartConfig): void {
    // Similar to line chart but with filled areas
    this.renderLineChart(ctx, config);
    
    // Add area fill
    const { width, height, data } = config;
    const padding = 50;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    if (data.length === 0) return;

    const maxValue = Math.max(...data.map(d => d.value));
    const minValue = Math.min(...data.map(d => d.value));
    const valueRange = maxValue - minValue || 1;

    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.beginPath();

    data.forEach((point, index) => {
      const x = padding + (chartWidth / (data.length - 1)) * index;
      const y = padding + chartHeight - ((point.value - minValue) / valueRange) * chartHeight;
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    // Close the area
    ctx.lineTo(width - padding, height - padding);
    ctx.lineTo(padding, height - padding);
    ctx.closePath();
    ctx.fill();
  }

  private renderGaugeChart(ctx: CanvasRenderingContext2D, config: ChartConfig): void {
    const { width, height, data } = config;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 20;
    
    const value = data[0]?.value || 0;
    const maxValue = 100;
    const percentage = value / maxValue;
    
    // Draw background arc
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI, 2 * Math.PI);
    ctx.stroke();
    
    // Draw value arc
    ctx.strokeStyle = percentage > 0.8 ? '#ef4444' : percentage > 0.6 ? '#f59e0b' : '#10b981';
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI, Math.PI + percentage * Math.PI);
    ctx.stroke();
    
    // Draw value text
    ctx.fillStyle = '#374151';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${value.toFixed(1)}%`, centerX, centerY + 10);
  }

  /**
   * Data preparation methods
   */
  private prepareSyncTrendData(): ChartDataPoint[] {
    // Mock data - in real implementation, this would come from historical data
    const hours = Array.from({ length: 24 }, (_, i) => i);
    return hours.map(hour => ({
      label: `${hour}:00`,
      value: Math.floor(Math.random() * 50 + 10)
    }));
  }

  private preparePerformanceData(): ChartDataPoint[] {
    return [
      { label: 'Latency', value: this.data.performanceMetrics.averageLatency },
      { label: 'Memory Usage', value: this.data.performanceMetrics.memoryUsage.current },
      { label: 'Cache Hit Rate', value: this.data.performanceMetrics.cacheHitRate }
    ];
  }

  private prepareErrorDistributionData(): ChartDataPoint[] {
    return Object.entries(this.data.errorMetrics.errorsByType).map(([type, count]) => ({
      label: type,
      value: count
    }));
  }

  private prepareNetworkUsageData(): ChartDataPoint[] {
    return Object.entries(this.data.usageMetrics.networkTypes).map(([type, count]) => ({
      label: type,
      value: count
    }));
  }

  /**
   * Utility methods
   */
  private async refreshData(): Promise<void> {
    try {
      this.data = await this.dataProvider();
      
      // Update last updated time
      const lastUpdatedEl = this.contentEl.querySelector('.last-updated') as HTMLElement;
      if (lastUpdatedEl) {
        lastUpdatedEl.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
      }
      
      this.logger.debug('Analytics data refreshed', {
        component: 'AnalyticsDashboard'
      });
    } catch (error) {
      this.logger.error('Failed to refresh analytics data', { error });
    }
  }

  private startAutoRefresh(): void {
    this.refreshInterval = setInterval(() => {
      this.refreshData();
    }, 30000); // Refresh every 30 seconds
  }

  private stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private exportData(): void {
    const dataToExport = {
      timestamp: new Date().toISOString(),
      analytics: this.data
    };
    
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], {
      type: 'application/json'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `git-sync-analytics-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private calculateSuccessRate(): number {
    const { successfulSyncs, totalSyncs } = this.data.syncMetrics;
    return totalSyncs > 0 ? (successfulSyncs / totalSyncs) * 100 : 0;
  }

  private calculateChangePercentage(metric: string): number {
    // Mock calculation - in real implementation, this would compare with previous period
    return Math.random() * 20 - 10; // -10% to +10%
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  private getAlertIcon(level: SystemAlert['level']): string {
    switch (level) {
      case 'info': return 'ℹ️';
      case 'warning': return '⚠️';
      case 'error': return '❌';
      case 'critical': return '🚨';
      default: return '📋';
    }
  }

  private getEmptyData(): AnalyticsData {
    return {
      syncMetrics: {
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        averageDuration: 0,
        totalDataTransferred: 0,
        conflictsResolved: 0,
        syncsByTimeOfDay: {},
        syncsByDayOfWeek: {},
        filesProcessed: 0,
        averageFileSize: 0
      },
      performanceMetrics: {
        averageLatency: 0,
        throughput: 0,
        memoryUsage: { average: 0, peak: 0, current: 0 },
        cacheHitRate: 0,
        networkEfficiency: 0,
        batteryImpact: 0
      },
      usageMetrics: {
        activeUsers: 0,
        sessionsPerUser: 0,
        averageSessionDuration: 0,
        featureUsage: {},
        deviceTypes: {},
        networkTypes: {},
        peakUsageHours: []
      },
      errorMetrics: {
        totalErrors: 0,
        errorsByType: {},
        errorsByComponent: {},
        errorRate: 0,
        meanTimeToResolution: 0,
        criticalErrors: 0,
        recentErrors: []
      },
      systemMetrics: {
        uptime: 0,
        availability: 0,
        resourceUtilization: { cpu: 0, memory: 0, storage: 0, network: 0 },
        healthScore: 100,
        alerts: []
      }
    };
  }
}