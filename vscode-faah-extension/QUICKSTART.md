# VS Code FAAH Extension - Quick Start Guide

## 🚀 First Time Setup

### Prerequisites
- VS Code 1.85 or later
- Node.js 16 or later
- npm or yarn

### Installation Steps

1. **Extract the extension**
   ```bash
   cd vscode-faah-extension
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Compile TypeScript**
   ```bash
   npm run compile
   ```

4. **Open in VS Code**
   ```bash
   code .
   ```

5. **Run/Debug the extension**
   - Press `F5` to start debugging
   - A new VS Code window will open with the extension loaded

## 📋 What's Included

✅ **Source Code** - Complete TypeScript implementation
✅ **Configuration** - package.json with all settings
✅ **Build Setup** - esbuild + TypeScript compilation
✅ **Documentation** - README and development notes
✅ **Comments** - Detailed explanations throughout code

## 🎯 Testing

### Test the Sound
1. Press `Ctrl+Shift+P` (Cmd+Shift+P on Mac)
2. Type "FAAH: Test Sound"
3. Press Enter

### Check Status
- Look at the bottom-right corner for "FAAH: ON/OFF" indicator
- Click to toggle the extension on/off

### Trigger an Error
1. Create a new .ts or .js file
2. Write invalid code: `const x = ;`
3. Watch for the FAAH sound and status indicators

## 📝 Customizing Settings

### Open Settings
- `Ctrl+,` (Windows/Linux) or `Cmd+,` (Mac)

### Search for FAAH
- Type "faah" in the settings search

### Adjust Settings
- `faah.enabled` - Toggle extension on/off
- `faah.cooldown` - Change sound interval (seconds)
- `faah.volume` - Adjust volume level
- `faah.enableRandomPitch` - Enable comedic beeping
- `faah.detectionEvents` - Choose which errors trigger sound

## 🔧 Build Commands

```bash
# Development build with watch mode
npm run watch

# Production build (minified)
npm run vscode:prepublish

# Run linter
npm run lint

# Compile without bundling
npm run compile
```

## 📦 Creating VSIX Package

To create a distribution package:

1. Install vsce (if not already installed)
   ```bash
   npm install -g vsce
   ```

2. Create the package
   ```bash
   vsce package
   ```

3. This creates `faah-1.0.0.vsix` which can be shared

## 🐛 Troubleshooting

### Extension not loading?
- Reload VS Code: `Ctrl+R` (Windows/Linux) or `Cmd+R` (Mac)
- Check Extension Development Host output for errors

### Sound not playing?
- Run "FAAH: Test Sound" command
- Check if extension is enabled in status bar
- Verify system volume is not muted
- Check browser console for errors

### Compilation errors?
```bash
# Clear and rebuild
rm -rf out node_modules
npm install
npm run compile
```

## 🎓 Next Steps

1. **Understand the code** - Read comments in source files
2. **Modify behavior** - Edit errorDetector.ts to change detection logic
3. **Add features** - Follow the pattern for adding new commands
4. **Test thoroughly** - Use Extension Development Host for testing
5. **Share it** - Package and publish to VS Code Marketplace

## 📚 Additional Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

## 💡 Tips & Tricks

### Quick Reload
While debugging, press `Ctrl+Shift+F5` to hot-reload the extension

### Access Console
- Go to Extensions > FAAH > Output tab to see logs
- Or in Debug Console during Extension Development Host

### Test with Real Errors
Create test files with various errors:
- TS error: `const x: number = "string";`
- Syntax error: `const x = ;`
- Build error: `cargo build` (if Rust project)

## 🎉 Success!

You should now see:
- ✅ "FAAH: ON" in the status bar
- ✅ Ability to run "FAAH: Test Sound" command
- ✅ Sound plays when errors/warnings appear
- ✅ Status toggles when clicking indicator

**Congratulations! Your FAAH extension is ready! 🎉**
