/**
 * FAAH Extension - Main Extension File
 * 
 * This file is the entry point for the FAAH VS Code extension.
 * It registers all event listeners, commands, and manages the extension lifecycle.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { AudioManager } from './audio';
import { ErrorDetector } from './errorDetector';
import { ExtensionState } from './state';

let extensionState: ExtensionState;
let audioManager: AudioManager;
let errorDetector: ErrorDetector;
let statusBarItem: vscode.StatusBarItem;

/**
 * Activation function - called when the extension is activated
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('FAAH Extension activated');

    try {
        // Initialize extension state with configuration
        extensionState = new ExtensionState(context);
        
        // Initialize audio manager with path to audio files
        const mediaPath = path.join(context.extensionPath, 'media');
        audioManager = new AudioManager(mediaPath, context);
        
        // Initialize error detector
        errorDetector = new ErrorDetector(audioManager, extensionState);

        // Create status bar indicator
        statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        updateStatusBar();
        statusBarItem.show();

        // Register commands
        registerCommands(context);

        // Listen to configuration changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(onConfigurationChanged)
        );

        // Listen to diagnostics changes
        context.subscriptions.push(
            vscode.languages.onDidChangeDiagnostics(
                (e) => errorDetector.handleDiagnosticsChange(e)
            )
        );

        // Listen to debug session start/stop
        context.subscriptions.push(
            vscode.debug.onDidStartDebugSession(
                () => errorDetector.handleDebugSessionStart()
            )
        );

        context.subscriptions.push(
            vscode.debug.onDidTerminateDebugSession(
                (e) => errorDetector.handleDebugSessionTerminate(e)
            )
        );

        // Listen to task execution
        context.subscriptions.push(
            vscode.tasks.onDidStartTask(
                (e) => errorDetector.handleTaskStart(e)
            )
        );

        context.subscriptions.push(
            vscode.tasks.onDidEndTask(
                (e) => errorDetector.handleTaskEnd(e)
            )
        );

        context.subscriptions.push(statusBarItem);
        context.subscriptions.push(audioManager);
        context.subscriptions.push(errorDetector);

    } catch (error) {
        console.error('Error activating FAAH extension:', error);
        vscode.window.showErrorMessage(`FAAH Extension error: ${error}`);
    }
}

/**
 * Register all extension commands
 */
function registerCommands(context: vscode.ExtensionContext) {
    // Test Sound command - manually play the sound
    context.subscriptions.push(
        vscode.commands.registerCommand('faah.testSound', async () => {
            if (!extensionState.isEnabled()) {
                vscode.window.showInformationMessage('FAAH is disabled. Enable it in settings.');
                return;
            }
            try {
                await audioManager.playSound('error', false);
                vscode.window.showInformationMessage('FAAH! 📢');
            } catch (error) {
                console.error('Error playing test sound:', error);
                vscode.window.showErrorMessage(`Failed to play sound: ${error}`);
            }
        })
    );

    // Toggle Enabled command - enable/disable the extension
    context.subscriptions.push(
        vscode.commands.registerCommand('faah.toggleEnabled', async () => {
            const currentState = extensionState.isEnabled();
            const newState = !currentState;
            
            await vscode.workspace.getConfiguration('faah').update(
                'enabled',
                newState,
                vscode.ConfigurationTarget.Global
            );

            vscode.window.showInformationMessage(
                `FAAH ${newState ? 'enabled' : 'disabled'}`
            );
            updateStatusBar();
        })
    );
}

/**
 * Handle configuration changes
 */
function onConfigurationChanged(event: vscode.ConfigurationChangeEvent) {
    if (event.affectsConfiguration('faah')) {
        extensionState.reload();
        errorDetector.resetCooldown();
        updateStatusBar();
        console.log('FAAH configuration updated');
    }
}

/**
 * Update status bar to show whether FAAH is enabled/disabled
 */
function updateStatusBar() {
    if (!statusBarItem) {
        return;
    }

    if (extensionState.isEnabled()) {
        statusBarItem.text = '$(bell-dot) FAAH: ON';
        statusBarItem.tooltip = 'FAAH is enabled. Click to toggle.';
        statusBarItem.command = 'faah.toggleEnabled';
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(bell) FAAH: OFF';
        statusBarItem.tooltip = 'FAAH is disabled. Click to toggle.';
        statusBarItem.command = 'faah.toggleEnabled';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

/**
 * Deactivation function - called when the extension is deactivated
 */
export function deactivate() {
    console.log('FAAH Extension deactivated');
    if (audioManager) {
        audioManager.dispose();
    }
}
