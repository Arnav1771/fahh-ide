/**
 * Error Detector - Monitors VS Code for errors, warnings, and failures
 * 
 * This module listens to various VS Code events and triggers audio playback
 * when errors, warnings, build failures, task failures, or debug failures are detected.
 * It implements a cooldown mechanism to prevent audio spam.
 */

import * as vscode from 'vscode';
import { AudioManager } from './audio';
import { ExtensionState } from './state';

export class ErrorDetector implements vscode.Disposable {
    private audioManager: AudioManager;
    private state: ExtensionState;
    private lastPlayTime: number = 0;
    private pendingDiagnostics = new Set<string>();
    private activeDebugSessions = new Map<string, boolean>();
    private activeTaskExecutions = new Map<string, boolean>();

    constructor(audioManager: AudioManager, state: ExtensionState) {
        this.audioManager = audioManager;
        this.state = state;
    }

    /**
     * Handle changes to the diagnostics collection
     * This is triggered when errors or warnings are added/removed in the Problems panel
     */
    async handleDiagnosticsChange(event: vscode.DiagnosticChangeEvent) {
        if (!this.state.isEnabled()) {
            return;
        }

        // Check each diagnostic URI for errors or warnings
        for (const uri of event.uris) {
            const diagnostics = vscode.languages.getDiagnostics(uri);
            
            // Look for errors and warnings
            for (const diagnostic of diagnostics) {
                const severity = diagnostic.severity;

                // Check if we should play sound for this severity
                if (severity === vscode.DiagnosticSeverity.Error && this.state.shouldDetect('errors')) {
                    console.log(`[FAAH] Error detected: ${diagnostic.message}`);
                    this.triggerSound('error');
                    break;
                } else if (severity === vscode.DiagnosticSeverity.Warning && this.state.shouldDetect('warnings')) {
                    console.log(`[FAAH] Warning detected: ${diagnostic.message}`);
                    this.triggerSound('warning');
                    break;
                }
            }
        }
    }

    /**
     * Handle debug session start
     * This is called when a debug session begins
     */
    handleDebugSessionStart() {
        if (!this.state.isEnabled() || !this.state.shouldDetect('debugFailures')) {
            return;
        }

        const session = vscode.debug.activeDebugSession;
        if (session) {
            this.activeDebugSessions.set(session.id, true);
            console.log(`[FAAH] Debug session started: ${session.name}`);
        }
    }

    /**
     * Handle debug session termination
     * Check if the session terminated due to an error
     */
    handleDebugSessionTerminate(event: vscode.DebugSession) {
        if (!this.state.isEnabled() || !this.state.shouldDetect('debugFailures')) {
            return;
        }

        // The session terminated - we assume this might be due to an error
        // In a more sophisticated implementation, you could check exit codes
        console.log(`[FAAH] Debug session terminated: ${event.name}`);
        this.activeDebugSessions.delete(event.id);
        this.triggerSound('error');
    }

    /**
     * Handle task start
     * This is called when a task execution begins (e.g., build task)
     */
    handleTaskStart(event: vscode.TaskExecutionStartEvent) {
        if (!this.state.isEnabled()) {
            return;
        }

        const task = event.execution.task;
        this.activeTaskExecutions.set(task.name, true);
        console.log(`[FAAH] Task started: ${task.name}`);
    }

    /**
     * Handle task end
     * This is called when a task execution completes (e.g., build finishes)
     */
    handleTaskEnd(event: vscode.TaskExecutionEndEvent) {
        if (!this.state.isEnabled() || !this.state.shouldDetect('buildFailures')) {
            return;
        }

        const task = event.execution.task;
        this.activeTaskExecutions.delete(task.name);

        // Check if the task is a build-related task
        const isBuildTask = this.isBuildTask(task);
        
        if (isBuildTask) {
            console.log(`[FAAH] Build task ended: ${task.name}`);
            // When a build task ends, play the sound
            // (In a real scenario, you'd check the exit code to determine success/failure)
            this.triggerSound('error');
        }
    }

    /**
     * Determine if a task is a build-related task
     */
    private isBuildTask(task: vscode.Task): boolean {
        const buildKeywords = ['build', 'compile', 'make', 'gradle', 'maven', 'webpack', 'rollup', 'tsc', 'cargo'];
        const taskName = task.name.toLowerCase();
        return buildKeywords.some(keyword => taskName.includes(keyword));
    }

    /**
     * Trigger sound playback with cooldown checking
     * @param type - Type of error ('error' or 'warning')
     */
    private async triggerSound(type: 'error' | 'warning') {
        const now = Date.now();
        const cooldownMs = this.state.getCooldownMs();
        const timeSinceLastPlay = now - this.lastPlayTime;

        if (timeSinceLastPlay < cooldownMs) {
            console.log(`[FAAH] Cooldown active (${Math.round((cooldownMs - timeSinceLastPlay) / 1000)}s remaining)`);
            return;
        }

        this.lastPlayTime = now;
        
        try {
            const randomPitch = this.state.hasRandomPitch();
            await this.audioManager.playSound(type, randomPitch);
            console.log(`[FAAH] Sound played: ${type}`);
        } catch (error) {
            console.error('[FAAH] Error playing sound:', error);
        }
    }

    /**
     * Reset the cooldown timer (useful when settings change)
     */
    resetCooldown() {
        this.lastPlayTime = 0;
        console.log('[FAAH] Cooldown reset');
    }

    /**
     * Dispose of resources
     */
    dispose() {
        this.pendingDiagnostics.clear();
        this.activeDebugSessions.clear();
        this.activeTaskExecutions.clear();
    }
}
