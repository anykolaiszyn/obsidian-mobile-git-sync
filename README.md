# 🚀 Mobile Git Sync for Obsidian

**The Rock Star of Git Sync** - A revolutionary mobile-first GitHub sync plugin for Obsidian that *actually works* on Android and iOS. Built from the ground up with comprehensive bidirectional synchronization that never misses a file.

## 🌟 Why This Plugin is Special

Unlike every other Git sync solution for Obsidian, this plugin:

- ✅ **Actually works on mobile** - Extensively tested on Android and iOS
- ✅ **Never misses files** - Revolutionary bidirectional sync compares local vs remote comprehensively
- ✅ **Handles files that exist only on one side** - Uploads local-only files, downloads remote-only files
- ✅ **Smart conflict resolution** - Multiple strategies: prompt, latest, local priority, remote priority
- ✅ **Visual progress tracking** - See exactly what's happening during large syncs
- ✅ **Desktop-class features on mobile** - All buttons, hotkeys, and UX work everywhere

## 🎯 Revolutionary Sync Technology

### 🔍 **Comprehensive Vault Scanning**
- Scans your **entire vault** on startup to detect ALL existing files
- No more "it only syncs files I've touched" - this syncs **everything**
- Compares local vs remote repositories comprehensively
- Finds files missing on either side and syncs them automatically

### 📊 **Intelligent Sync Planning**
- **Preview sync operations** before executing them
- See exactly what will be uploaded, downloaded, or needs conflict resolution
- Get detailed file counts and operation summaries
- Cancel or proceed with confidence

### ⚡ **Smart Progress Tracking**
- Visual progress bars for large sync operations (10+ files)
- Real-time status updates in status bar
- File-by-file progress with operation names
- Never wonder what's happening during sync again

## 🚀 Features That Make It Amazing

### 📱 **Mobile-First Design**
- **Optimized for touch** - All buttons and modals work perfectly on mobile
- **Memory efficient** - Designed for devices with limited resources
- **Background syncing** - Works seamlessly without interrupting your workflow
- **Offline queue** - Changes stored locally and synced when connectivity returns
- **Mobile notifications** - Important sync events shown as notices on mobile

### 🎮 **Desktop-Class Features**
- **Keyboard shortcuts** - Full hotkey support for power users
- **Right-click menus** - Context actions on files and folders
- **Ribbon integration** - Quick access button in the sidebar
- **Status bar controls** - Interactive sync status with click actions
- **Force push/pull** - Advanced Git operations when needed

### 🧠 **Intelligent Sync Logic**
- **Event-driven changes** - Only syncs files that have actually changed
- **Bidirectional comparison** - Finds differences in both directions
- **Conflict resolution strategies** - Choose how to handle conflicts automatically
- **Selective sync** - Exclude files and folders with pattern matching
- **Branch switching** - Work with multiple Git branches seamlessly

## 📋 Complete Command Arsenal

Access these via Command Palette (Ctrl/Cmd + P) or ribbon icon:

### 🔄 **Core Sync Commands**
- **🔄 Full Sync (Pull then Push)** `Ctrl+Shift+S` - Complete bidirectional sync
- **⬆️ Push Changes Only** `Ctrl+Shift+P` - Upload local changes
- **⬇️ Pull Changes Only** `Ctrl+Shift+L` - Download remote changes
- **🧠 Smart Sync** `Ctrl+Alt+S` - Auto-resolve conflicts intelligently

### 📊 **Planning & Analysis**
- **📊 Show Sync Plan** - Preview what will be synced before executing
- **🔍 Scan Vault for Changes** - Detect all files in vault for sync
- **📋 View Pending Changes** `Ctrl+Shift+V` - See queued changes
- **🚀 Push All Local Files** `Ctrl+Shift+Alt+U` - Upload everything local

### 📄 **File-Level Operations**
- **📄 Sync Current File Only** `Ctrl+U` - Sync just the active file
- **💾 Quick Commit with Message** `Ctrl+Shift+C` - Custom commit message
- **📜 View Sync History** `Ctrl+Shift+H` - See detailed sync logs

### 🛠️ **Advanced Features**
- **🌿 Switch Branch** `Ctrl+Shift+B` - Change Git branch
- **⚡ Force Push** `Ctrl+Shift+Alt+P` - Override remote (dangerous!)
- **🔄 Toggle Auto-Sync** `Ctrl+Shift+A` - Enable/disable automatic sync
- **⚙️ Open Git Sync Settings** `Ctrl+Shift+G` - Quick settings access

## 🔧 Complete Setup Guide

### Step 1: Install the Plugin
1. Open Obsidian Settings → Community Plugins
2. Search for "Mobile Git Sync"
3. Install and enable the plugin
4. Works on desktop, Android, and iOS

### Step 2: Create GitHub Repository & Token

#### Create Repository
1. Go to [GitHub](https://github.com) and create a new repository
2. Name it something like `obsidian-vault` or `my-notes`
3. Set it to **Private** (recommended for personal notes)
4. Don't initialize with README, .gitignore, or license

#### Create Personal Access Token
1. Go to [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Click **"Generate new token (classic)"**
3. Give it a descriptive name: `Obsidian Mobile Sync`
4. Set expiration (recommend 1 year)
5. Select **`repo`** scope (full control of private repositories)
6. Click **"Generate token"** and **COPY THE TOKEN** (you won't see it again!)

### Step 3: Configure Plugin Settings

1. **Open Settings**: Obsidian Settings → Community Plugins → Mobile Git Sync
2. **Repository URL**: `https://github.com/yourusername/yourrepo`
3. **GitHub Token**: Paste the token you just created
4. **Branch**: `main` (or `master` for older repos)
5. **Conflict Strategy**: Choose your preference:
   - **Prompt** - Ask you what to do for each conflict
   - **Latest** - Automatically use the most recently modified version
   - **Local** - Always keep your local version
   - **Remote** - Always use the remote version

### Step 4: Initial Sync Setup

#### If Starting Fresh (Empty Vault)
1. Click **"🔍 Scan Vault for Changes"** command
2. Use **"⬇️ Pull Changes Only"** to download existing files
3. Start working with your notes!

#### If You Have Existing Notes
1. Click **"🔍 Scan Vault for Changes"** command
2. Use **"📊 Show Sync Plan"** to see what will be uploaded
3. Click **"🚀 Push All Local Files"** to upload everything
4. Your notes are now safely backed up to GitHub!

### Step 5: Enable Auto-Sync (Optional)
1. In settings, enable **"Auto-sync"**
2. Set **"Auto-sync interval"** (recommended: 5-15 minutes)
3. Your notes will now sync automatically in the background

## 🎯 How to Use Like a Pro

### 📊 **Start with Sync Plan**
Before any major sync operation:
1. Run **"📊 Show Sync Plan"** command
2. Review what will be uploaded/downloaded
3. Check for conflicts that need resolution
4. Click "Execute Sync" when ready

### 🔍 **Regular Vault Scanning**
Run **"🔍 Scan Vault for Changes"** regularly to:
- Detect files you've added outside Obsidian
- Find files that weren't tracked automatically
- Ensure comprehensive sync coverage

### 📋 **Monitor Pending Changes**
Use **"📋 View Pending Changes"** to:
- See what's queued for next sync
- Review files before they're uploaded
- Cancel individual file changes if needed

### 🧠 **Smart Sync for Conflicts**
When you have conflicts:
1. Use **"🧠 Smart Sync"** for automatic resolution
2. Or use **"📊 Show Sync Plan"** to review conflicts manually
3. Choose your conflict resolution strategy in settings

## ⚙️ Advanced Configuration

### 🎯 **Selective Sync Patterns**
Exclude files and folders using these patterns in settings:

```
.obsidian/workspace*     # Workspace files (device-specific)
.obsidian/app.json       # App settings
.trash/**                # Deleted files folder
Private/**               # Private folders
*.tmp                    # Temporary files
**/.DS_Store            # macOS system files
**/Thumbs.db            # Windows system files
```

### 🌿 **Branch Strategy**
- **main** - Your primary notes branch
- **mobile** - Separate branch for mobile-only notes
- **work** - Work-related notes branch
- **archive** - Old notes you want to keep separate

### 🔄 **Auto-Sync Best Practices**
- **Frequent syncing** (5-10 minutes) for active collaboration
- **Less frequent** (30-60 minutes) for personal use
- **Disable auto-sync** when working offline extensively
- **Manual sync** before important meetings or presentations

## 🔍 Understanding Sync Operations

### ⬆️ **Upload Operations (Local → Remote)**
- Files that exist only on your device
- Files that are newer locally than remotely
- New notes you've created
- Modified existing notes

### ⬇️ **Download Operations (Remote → Local)**
- Files that exist only on GitHub
- Files that are newer remotely than locally
- Notes created on other devices
- Changes from other people (if sharing)

### ⚠️ **Conflict Resolution**
When the same file is modified in both places:
- **Prompt**: Ask you what to do each time
- **Latest**: Use whichever version was modified most recently
- **Local**: Always keep your local version (upload it)
- **Remote**: Always use the remote version (download it)

## 🛠️ Troubleshooting Guide

### 🚨 **Common Issues & Solutions**

#### **"GitHub token in wrong field" Error**
**Problem**: You put your token in Repository URL field
**Solution**: 
1. Repository URL: `https://github.com/username/repo`
2. GitHub Token: `ghp_xxxxxxxxxxxxx`

#### **"404 errors when pulling" Error**
**Problem**: Trying to download files that don't exist yet
**Solution**: Start with "Push All Local Files" to upload your notes first

#### **"Auto-sync restart loops" Error**
**Problem**: Settings changes triggering infinite restarts
**Solution**: 
1. Disable auto-sync temporarily
2. Configure all settings
3. Re-enable auto-sync when done

#### **"Files not syncing" Problem**
**Problem**: Only touched files sync, not everything
**Solution**: This is fixed! Use these commands:
1. **"🔍 Scan Vault for Changes"** - Detects all files
2. **"📊 Show Sync Plan"** - Shows what will sync
3. **"🚀 Execute Sync"** - Syncs everything missing

#### **Mobile Performance Issues**
**Solutions**:
- Reduce auto-sync frequency (30+ minutes)
- Use selective sync to exclude large folders
- Restart Obsidian if sync gets stuck
- Check available storage space

#### **Sync Gets Stuck**
**Solutions**:
1. Check internet connection
2. Verify GitHub token hasn't expired
3. Use **"📜 View Sync History"** to see error details
4. Restart auto-sync with toggle command
5. Try manual sync with **"🔄 Full Sync"**

### 🔧 **Advanced Troubleshooting**

#### **Reset Everything**
If things go wrong:
1. Disable auto-sync
2. Clear all settings in plugin config
3. Re-enter repository URL and token
4. Run **"🔍 Scan Vault for Changes"**
5. Use **"📊 Show Sync Plan"** to review
6. Re-enable auto-sync

#### **Token Permissions**
Your GitHub token needs:
- ✅ **repo** scope (full repository access)
- ✅ **private repo** access if using private repository
- ❌ No other scopes needed

#### **Network Issues**
- Use HTTPS repository URLs only
- Check firewall settings on corporate networks
- Verify GitHub isn't blocked
- Try manual sync first before auto-sync

## 🔒 Security & Privacy

### 🛡️ **Data Security**
- **Your notes stay yours** - Everything stored in your private GitHub repo
- **Token security** - Tokens stored locally on devices only
- **HTTPS encryption** - All communication encrypted
- **Limited permissions** - Token only needs repository access
- **No cloud middleman** - Direct sync between your devices and GitHub

### 🔐 **Privacy Best Practices**
1. **Use private repositories** for personal notes
2. **Rotate tokens regularly** (every 6-12 months)
3. **Revoke tokens immediately** if device is lost/stolen
4. **Review repository access** periodically
5. **Use separate repos** for different types of content
6. **Enable 2FA** on your GitHub account

### 🚨 **If Something Goes Wrong**
1. **Revoke the token** immediately at [GitHub Settings](https://github.com/settings/tokens)
2. **Change your GitHub password** if you suspect compromise
3. **Review repository access logs** in GitHub settings
4. **Create a new token** with fresh permissions
5. **Check for unauthorized commits** in your repository history

## 🌟 Pro Tips for Power Users

### ⚡ **Keyboard Workflow**
- `Ctrl+Shift+S` → Full sync (most common operation)
- `Ctrl+Shift+V` → Check what's pending
- `Ctrl+Shift+C` → Quick commit with custom message
- `Ctrl+Shift+H` → View detailed sync history

### 📊 **Before Important Work**
1. Run **"📊 Show Sync Plan"** to see status
2. Execute any pending syncs
3. Use **"⬇️ Pull Changes Only"** to get latest
4. Start working with confidence

### 🔄 **Daily Workflow**
1. **Morning**: Pull latest changes with `Ctrl+Shift+L`
2. **During work**: Let auto-sync handle changes automatically
3. **Evening**: Check sync history with `Ctrl+Shift+H`
4. **Before closing**: Ensure everything synced with `Ctrl+Shift+V`

### 🌿 **Branch Management**
- Use **"🌿 Switch Branch"** for different contexts
- Keep `main` for stable notes
- Use `draft` or `wip` for experimental content
- Create topic branches for specific projects

## 🤝 Contributing & Support

### 🐛 **Found a Bug?**
1. Check the **"📜 View Sync History"** for error details
2. Try the troubleshooting steps above
3. Create an issue with:
   - Your device/OS info
   - Steps to reproduce
   - Error messages from sync history
   - Screenshots if relevant

### 💡 **Feature Requests**
This plugin is actively developed! Suggest improvements:
- Better mobile UI/UX
- Additional sync strategies
- Integration features
- Performance optimizations

### 🧪 **Testing & Development**
Help make this plugin even better:
- Test on different devices (Android, iOS, desktop)
- Try edge cases (large vaults, slow networks, conflicts)
- Provide feedback on UX improvements
- Contribute code improvements

## 📄 License & Acknowledgments

**MIT License** - Free and open source forever.

### 🙏 **Built With Love For**
- The Obsidian community who needed *real* mobile Git sync
- Mobile users tired of plugins that "almost work"
- Power users who want desktop-class features everywhere
- Anyone who believes sync should "just work"

### 🎯 **Special Thanks**
- Inspired by the Obsidian Git plugin (desktop-focused)
- Built with GitHub API for maximum compatibility
- Designed specifically for the mobile Obsidian experience
- Tested extensively on real devices by real users

---

## 🎉 **Ready to Become a Sync Rock Star?**

This plugin transforms Obsidian's sync experience from "sometimes works" to "rock star reliable." Whether you're on mobile, desktop, or switching between devices, your notes will always be perfectly synchronized.

**Install now and never worry about sync again!**

*Focus on your brilliant ideas, not on whether they'll sync.*

---

**Made with ❤️ and lots of mobile testing**

*"The sync solution Obsidian mobile users have been waiting for."*