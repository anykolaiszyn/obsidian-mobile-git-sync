# Mobile Git Sync for Obsidian

A mobile-first GitHub sync plugin for Obsidian, designed specifically for seamless note synchronization across all your devices, with special attention to Android and iOS compatibility.

## 🚀 Features

### Mobile-First Design
- **Optimized for mobile devices** - Works flawlessly on Android and iOS
- **Background syncing** - Automatic sync without interrupting your workflow
- **Offline queue** - Changes are queued when offline and synced when connectivity returns
- **Minimal taps** - Set it up once and let it work automatically
- **Performance-aware log display** - Only the last 100 sync log entries are shown for speed on mobile
- **Clear Log button** - Easily clear sync history from the log modal
- **Critical sync events always shown** - Important sync status is always shown as a Notice, even if the status bar is hidden on mobile

### Smart Sync Technology
- **Event-driven changes** - Only syncs files that have actually changed
- **Conflict resolution** - Automatic handling of edit conflicts with data preservation
- **Selective sync** - Choose which files and folders to include/exclude
- **Scheduled syncing** - Configurable auto-sync intervals

### Easy Setup
- **GitHub Personal Access Token** authentication (no SSH complexity)
- **One-time configuration** - Simple setup process with clear instructions
- **Repository initialization** - Automatically sets up Git repository
- **Test connectivity** - Verify your configuration before syncing

## 📱 Why Mobile-First?

Unlike existing Git plugins for Obsidian that struggle on mobile devices, this plugin is built from the ground up with mobile performance and reliability in mind:

- **No desktop dependencies** - Everything runs natively in Obsidian
- **Memory efficient** - Designed for devices with limited resources
- **Stable on mobile** - Tested extensively on Android and iOS
- **Touch-friendly UI** - Optimized for mobile interaction patterns

## 🔧 Setup Instructions

### 1. Install the Plugin
- Download and enable "Mobile Git Sync" from Obsidian's Community Plugins
- Available on both desktop and mobile versions

### 2. Create a GitHub Personal Access Token
1. Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Give it a name like "Obsidian Mobile Sync"
4. Select the **repo** scope (full control of private repositories)
5. Click "Generate token" and copy the token

### 3. Configure Plugin Settings
1. Open Obsidian Settings → Community Plugins → Mobile Git Sync
2. Enter your GitHub Personal Access Token
3. Enter your repository URL (e.g., `https://github.com/username/my-notes.git`)
4. Enter your GitHub username and email
5. Choose your branch (usually `main` or `master`)
6. Click "Test Configuration" to verify everything works

### 4. Initialize Repository
- Click "Initialize Repository" to set up Git in your vault
- If your vault is empty, it will clone your existing repository
- If your vault has notes, it will create a new repository and push your files

### 5. Start Syncing
- That's it! Your notes will now sync automatically
- Use "Sync Now" command for manual syncing
- Check "View Pending Changes" to see what will be synced

## ⚙️ Configuration Options

### Auto-Sync Settings
- **Enable Auto-sync** - Toggle automatic background syncing
- **Sync Interval** - Set how often to sync (1-60 minutes)
- **Auto-pull on startup** - Fetch updates when opening Obsidian

### Selective Sync
Exclude files and folders from syncing using patterns:
```
.obsidian/**     # Obsidian configuration files
.trash/**        # Deleted files
private/**       # Private folders
*.tmp            # Temporary files
```

### Advanced Options
- **Branch selection** - Choose which Git branch to sync
- **Commit messages** - Customize automatic commit messages
- **Conflict handling** - Configure how conflicts are resolved (Prompt, Take Latest, Always Keep Local, Always Keep Remote)

## 🔄 How It Works

### Automatic Syncing
1. **File Changes Detected** - Plugin monitors all file operations in real-time
2. **Changes Queued** - Modified files are added to an internal queue
3. **Background Sync** - At configured intervals, changes are synced to GitHub
4. **Conflict Resolution** - Any conflicts are automatically handled

### Offline Support
- **Queue Changes** - When offline, all changes are stored locally
- **Sync on Reconnect** - Once internet returns, queued changes are synced
- **Order Preservation** - Changes are applied in the correct sequence

### Conflict Handling
- **Non-overlapping Changes** - Automatically merged when possible
- **True Conflicts** - Both versions saved with conflict markers
- **User Notification** - Clear alerts when manual review is needed (unless you choose automatic resolution)
- **Data Safety** - No content is ever lost during conflicts
- **Configurable Strategy** - Choose to always take the latest, always keep local, always keep remote, or be prompted for each conflict

## 📋 Commands

Access these commands via the Command Palette (Ctrl/Cmd + P):

- **Sync Now** - Manually trigger an immediate sync
- **View Pending Changes** - See what files are queued for sync
- **Initialize Repository** - Set up Git repository in current vault

## 🔒 Security & Privacy

### Data Security
- **Your data stays yours** - Notes remain in your private GitHub repository
- **Token security** - Access tokens stored locally on your devices only
- **HTTPS only** - All communication encrypted via HTTPS
- **Limited scope** - Tokens only need repository access

### Privacy Best Practices
- Use a **private repository** for your notes
- **Review and rotate** access tokens periodically
- **Revoke tokens** if a device is lost or compromised
- **Limit token scope** to only necessary permissions

## 🛠️ Troubleshooting

### Common Issues

**Sync Fails**
- Check your internet connection
- Verify your GitHub token hasn't expired
- Ensure repository URL is correct

**Conflicts**
- Look for files with "_conflict" in the name
- Open conflicted files to review differences
- Merge manually and sync again

**Mobile Performance**
- Reduce sync frequency if experiencing slowness
- Use selective sync to exclude large folders
- Restart Obsidian if sync gets stuck

### Getting Help
- Check the plugin logs in developer console
- Review GitHub repository for known issues
- Create an issue with detailed error information

## 🔄 Migration from Other Plugins

### From Obsidian Git Plugin
1. Disable the existing Git plugin
2. Your existing Git repository will work with Mobile Git Sync
3. Configure Mobile Git Sync with your existing credentials
4. Test sync before removing the old plugin

### From Obsidian Sync
1. Export your notes to a local vault
2. Set up Mobile Git Sync with a new GitHub repository
3. Initialize the repository to upload your notes
4. Verify all notes synced correctly

## 🤝 Contributing

This plugin is open source! Contributions are welcome:

- **Bug reports** - Create an issue with reproduction steps
- **Feature requests** - Suggest improvements for mobile experience
- **Code contributions** - Submit pull requests with fixes or features
- **Testing** - Help test on different mobile devices

## 📄 License

MIT License - See LICENSE file for details.

## 🙏 Acknowledgments

- Inspired by the [Obsidian Git plugin](https://github.com/Vinzent03/obsidian-git)
- Built with [isomorphic-git](https://isomorphic-git.org/) for JavaScript Git operations
- Designed specifically for the mobile Obsidian experience

---

**Made with ❤️ for the Obsidian community**

*Focus on your notes, not on syncing them.*
