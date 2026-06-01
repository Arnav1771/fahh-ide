/**
 * Extension State Manager
 * 
 * This module manages the extension's configuration and state,
 * including settings for cooldown, volume, and detection events.
 */

import * as vscode from 'vscode';

export class ExtensionState {
    private context: vscode.ExtensionContext;
    private config: vscode.WorkspaceConfiguration;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.config = vscode.workspace.getConfiguration('faah');
    }

    /**
     * Reload configuration from VS Code settings
     */
    reload() {
        this.config = vscode.workspace.getConfiguration('faah');
    }

    /**
     * Check if the extension is enabled
     */
    isEnabled(): boolean {
        return this.config.get<boolean>('enabled', true);
    }

    /**
     * Get the cooldown period in milliseconds
     */
    getCooldownMs(): number {
        const seconds = this.config.get<number>('cooldown', 3);
        return seconds * 1000;
    }

    /**
     * Get the volume level (0-1)
     */
    getVolume(): number {
        return this.config.get<number>('volume', 1);
    }

    /**
     * Check if random pitch variation is enabled
     */
    hasRandomPitch(): boolean {
        return this.config.get<boolean>('enableRandomPitch', false);
    }

    /**
     * Get enabled detection events
     */
    getDetectionEvents(): string[] {
        return this.config.get<string[]>('detectionEvents', [
            'errors',
            'warnings',
            'buildFailures',
            'taskFailures',
            'debugFailures'
        ]);
    }

    /**
     * Check if a specific event type should be detected
     */
    shouldDetect(eventType: 'errors' | 'warnings' | 'buildFailures' | 'taskFailures' | 'debugFailures'): boolean {
        const events = this.getDetectionEvents();
        return events.includes(eventType);
    }

    /**
     * Store state in VS Code context (persisted across sessions)
     */
    setPersistedState(key: string, value: any) {
        return this.context.globalState.update(key, value);
    }

    /**
     * Retrieve persisted state
     */
    getPersistedState<T>(key: string, defaultValue?: T): T | undefined {
        return this.context.globalState.get<T>(key, defaultValue);
    }
}
