# FAAH - VS Code Error Sound Effect Extension

![FAAH Extension](media/icon.png)

**Play the iconic "FAAH!" sound effect whenever VS Code detects errors, warnings, build failures, task failures, or debug session failures.**

Transform your coding experience with auditory feedback! FAAH helps you catch errors faster by combining visual diagnostics with satisfying sound effects.

## Features

✨ **Core Features:**
- 🔊 Plays the iconic "FAAH!" sound effect on:
  - TypeScript/JavaScript errors
  - Build failures
  - Task execution failures
  - Debug session failures
  - Warning messages in the Problems panel
- ⏱️ **Cooldown Prevention** - Configurable cooldown (default 3s) to prevent audio spam
- 🎚️ **Volume Control** - Adjust volume from silent to full blast
- 🎲 **Random Pitch Variation** - Optional comedic effect with random pitch changes
- 🎛️ **Event Filtering** - Choose which types of events trigger the sound
- 🔘 **Status Bar Indicator** - See at a glance whether FAAH is enabled
- ⚡ **One-Click Toggle** - Enable/disable from the status bar

🎮 **Commands:**
- `FAAH: Test Sound` - Manually play the sound effect to test
- `FAAH: Toggle Extension` - Quickly enable/disable from the command palette

## Installation

### From the Marketplace (Coming Soon)
1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "FAAH"
4. Click Install

### Manual Installation
1. Download the `.vsix` file from the releases page
2. In VS Code, open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Click the "..." menu and select "Install from VSIX..."
4. Select the downloaded file

### Development Installation
```bash
cd vscode-faah-extension
npm install
npm run compile
code --install-extension faah-1.0.0.vsix
```

## Configuration

All settings are available in VS Code settings under the `faah` namespace.

### Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `faah.enabled` | boolean | `true` | Enable/disable the FAAH sound effect |
| `faah.cooldown` | number | `3` | Cooldown period in seconds between sound plays (0-30) |
| `faah.volume` | number | `1` | Volume level (0 = silent, 1 = full volume) |
| `faah.enableRandomPitch` | boolean | `false` | Enable random pitch variation for comedic effect |
| `faah.detectionEvents` | array | `["errors", "warnings", "buildFailures", "taskFailures", "debugFailures"]` | Which events trigger the sound |

### Configuration Examples

#### Disable warnings, only alert on errors
```json
{
  "faah.detectionEvents": ["errors", "buildFailures", "taskFailures", "debugFailures"]
}
```

#### Quick feedback with 1 second cooldown
```json
{
  "faah.cooldown": 1,
  "faah.enableRandomPitch": true
}
```

#### Quiet mode (50% volume with 5 second cooldown)
```json
{
  "faah.volume": 0.5,
  "faah.cooldown": 5
}
```

## Usage

### Automatic Error Detection
Simply enable the extension and start coding. FAAH will automatically play the sound whenever:
- Errors appear in the Problems panel
- Warnings appear in the Problems panel
- Build tasks fail
- Debug sessions terminate
- Task execution fails

### Manual Sound Test
1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Search for "FAAH: Test Sound"
3. Press Enter to play the sound

### Toggle Extension
**Option 1: Status Bar**
- Click the "FAAH: ON" or "FAAH: OFF" indicator in the status bar (bottom right)

**Option 2: Command Palette**
1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Search for "FAAH: Toggle Extension"
3. Press Enter

**Option 3: Settings**
- Open Settings (`Ctrl+,` / `Cmd+,`)
- Search for "faah.enabled"
- Toggle the checkbox

## How It Works

### Error Detection System

The extension monitors multiple sources of errors and failures:

1. **Diagnostics Monitoring** - Listens to the VS Code diagnostics API to detect when errors or warnings are added to the Problems panel
   
2. **Build Task Detection** - Monitors task execution and detects when build-related tasks complete (cargo, npm, webpack, etc.)

3. **Debug Session Tracking** - Listens for debug session termination events which may indicate runtime errors

4. **Cooldown Mechanism** - Prevents audio spam by enforcing a minimum time interval between sound plays

5. **Event Filtering** - Only plays sounds for configured event types, allowing customization

### Sound Playback

- The extension loads the `faah.mp3` audio file at startup
- Sound playback is handled through the system audio API
- Volume is controlled through extension settings
- Random pitch variation (when enabled) plays multiple beeps for comedic effect

## Keyboard Shortcuts

You can add custom keyboard shortcuts for FAAH commands:

1. Open Keyboard Shortcuts (`Ctrl+K Ctrl+S` / `Cmd+K Cmd+S`)
2. Search for "FAAH"
3. Click the add button next to desired command
4. Press your desired key combination

### Example Shortcuts
```json
{
  "key": "ctrl+alt+f",
  "command": "faah.testSound",
  "when": "editorTextFocus"
},
{
  "key": "ctrl+alt+shift+f",
  "command": "faah.toggleEnabled"
}
```

## Development Guide

### Project Structure
```
vscode-faah-extension/
├── src/
│   ├── extension.ts          # Main entry point and command registration
│   ├── errorDetector.ts      # Error/warning detection logic
│   ├── audio.ts              # Sound playback management
│   └── state.ts              # Configuration and state management
├── media/
│   ├── faah.mp3              # The iconic sound effect
│   └── icon.png              # Extension icon
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

### Prerequisites
- Node.js 16+
- VS Code 1.85+
- TypeScript 5+

### Setup Development Environment

1. Clone the repository
```bash
git clone https://github.com/Arnav1771/fahh-ide.git
cd fahh-ide/vscode-faah-extension
```

2. Install dependencies
```bash
npm install
```

3. Build the extension
```bash
npm run compile
```

4. Run tests (if available)
```bash
npm run test
```

### Development Workflow

**Watch mode** (automatically recompile on changes):
```bash
npm run watch
```

**Linting**:
```bash
npm run lint
```

**Building for release**:
```bash
npm run vscode:prepublish
```

### Debugging

1. Open the project in VS Code
2. Press `F5` to start debugging
3. A new VS Code window will open with the extension loaded
4. You can set breakpoints and inspect variables
5. Press `Ctrl+Shift+F5` to reload the extension

### Code Structure

#### `extension.ts` - Main Extension File
- Registers all commands and event listeners
- Manages the extension lifecycle
- Initializes the audio manager and error detector
- Updates the status bar indicator

#### `errorDetector.ts` - Error Detection
- Monitors VS Code diagnostics API
- Listens to task execution events
- Listens to debug session events
- Implements cooldown logic
- Filters events based on settings

#### `audio.ts` - Audio Playback
- Loads the FAAH audio file
- Handles sound playback
- Supports random pitch variation
- Manages volume levels

#### `state.ts` - Extension State
- Manages configuration from settings
- Provides centralized access to settings
- Manages persisted state across sessions

### Adding New Features

**Add a new detection event:**
1. Add the event type to the `detectionEvents` array in `package.json`
2. Add a new method in `ErrorDetector` to listen to the event
3. Call `triggerSound()` when the event occurs

**Add a new command:**
1. Add the command to the `commands` array in `package.json`
2. Register it in the `registerCommands()` function in `extension.ts`
3. Implement the command handler

**Add a new setting:**
1. Add it to the `configuration.properties` in `package.json`
2. Add a getter method in `state.ts`
3. Use it in your implementation

### Publishing

To publish the extension to the VS Code Marketplace:

1. Update version in `package.json`
2. Build the extension:
   ```bash
   npm run vscode:prepublish
   ```
3. Create VSIX package:
   ```bash
   vsce package
   ```
4. Publish:
   ```bash
   vsce publish
   ```

## Troubleshooting

### Sound doesn't play
- Check that `faah.enabled` is set to `true`
- Verify cooldown period hasn't elapsed
- Check system volume is not muted
- Try the "FAAH: Test Sound" command to confirm audio works
- Check browser console for errors: `Help > Toggle Developer Tools > Console`

### Too much audio spam
- Increase the `faah.cooldown` setting
- Disable event types you don't want in `faah.detectionEvents`
- Disable `faah.enableRandomPitch` if it's causing excessive noise

### Extension not activating
- Reload VS Code window: `Cmd+R` (Mac) or `Ctrl+R` (Windows/Linux)
- Check the Extension Development Host output
- Ensure you're using VS Code 1.85 or later

### FAAH command not appearing
- Open Command Palette and search for "FAAH"
- Reload VS Code window
- Check that the extension is not disabled in the Extensions view

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Lint your code (`npm run lint`)
5. Commit with clear messages
6. Push to the branch
7. Open a Pull Request

## Roadmap

🚀 **Planned Features:**
- [ ] Different sounds for different error types
- [ ] Sound library selection in settings
- [ ] Integration with VS Code themes
- [ ] Stats tracking (errors per day, etc.)
- [ ] Custom sound upload support
- [ ] Slack/Discord webhook notifications with sound
- [ ] MIDI output for unique integration scenarios

📝 **Known Issues:**
- Sound playback may not work in remote SSH sessions (WSL/SSH containers)
- Random pitch variation uses system beep rather than audio file

## Performance

- **Memory Usage**: ~2-5 MB (including audio buffer)
- **Startup Time**: <100ms
- **CPU Impact**: Minimal (event-driven architecture)

## Privacy & Telemetry

- ✅ **No telemetry** - We don't collect any usage data
- ✅ **No tracking** - Your activity remains private
- ✅ **No external calls** - Everything runs locally
- ✅ **Open source** - Fully auditable code

## License

MIT - See LICENSE file for details

## Support

- 📖 [Documentation](README.md)
- 🐛 [Report Issues](https://github.com/Arnav1771/fahh-ide/issues)
- 💬 [Discussions](https://github.com/Arnav1771/fahh-ide/discussions)
- ✉️ Email: support@fahh-ide.dev

## Credits

**FAAH** is developed with ❤️ by the fahh-ide community.

Special thanks to:
- VS Code Extension API documentation
- The VS Code community

---

**Made with ❤️ for developers who want to hear their errors coming**

> "If you can't see the error, at least you can hear it!" - FAAH Philosophy
