# FAAH Extension Development Notes

## Architecture Overview

The FAAH extension follows a modular architecture with clear separation of concerns:

### Module Dependencies
```
extension.ts (main entry)
  ├── audio.ts (sound playback)
  ├── errorDetector.ts (error detection)
  │   └── uses → audio.ts
  │   └── uses → state.ts
  └── state.ts (configuration management)
```

## Event Flow

```
VS Code Event
    ↓
ErrorDetector.handleX() Method
    ↓
Check: isEnabled() && shouldDetect()
    ↓
Check: Cooldown elapsed?
    ↓
triggerSound()
    ↓
AudioManager.playSound()
    ↓
System Audio Output
```

## Configuration Loading

```
package.json (defaults)
    ↓
VS Code Configuration API
    ↓
ExtensionState.getX() methods
    ↓
Used by ErrorDetector & AudioManager
```

## Debugging Tips

### Enable Debug Output
Add to VS Code settings:
```json
"[FAAH]": {
  "editor.formatOnSave": false
}
```

### Check Console Output
```
Extension Development Host > Debug Console
```

### Test Specific Events
```typescript
// In debug console of Extension Development Host:
vscode.commands.executeCommand('faah.testSound');
```

## Known Limitations

1. **Sound Playback** - Currently uses system bell due to VS Code extension API limitations. Consider using `node-speaker` or `play-sound` package for MP3 playback.

2. **Debug Session Failures** - Requires checking exit codes/error messages which are not always available through the VS Code API

3. **Build Task Failures** - Detection is based on task completion; actual error status requires parsing task output

4. **Remote Development** - May not work properly in remote SSH or container environments

## Future Improvements

- [ ] Use native audio library for MP3 playback
- [ ] Detect actual build failure exit codes
- [ ] Support for user-provided audio files
- [ ] Multiple sound profiles
- [ ] Web version for remote development
- [ ] Integration with VS Code extensions for better error context

## Performance Considerations

- Audio buffer is loaded once at startup (~1-2s for MP3 file)
- Event listeners are lightweight and event-driven
- Cooldown prevents excessive function calls
- Settings are cached in memory and reloaded on change
