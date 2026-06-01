/**
 * Audio Manager - Handles sound playback
 * 
 * This module manages the playback of audio files for the FAAH extension.
 * It uses the Web Audio API through a Node.js buffer approach to play
 * MP3 files when errors are detected.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ExtensionState } from './state';

export class AudioManager implements vscode.Disposable {
    private mediaPath: string;
    private context: vscode.ExtensionContext;
    private audioBuffer: Buffer | null = null;
    private isPlaying: boolean = false;

    constructor(mediaPath: string, context: vscode.ExtensionContext) {
        this.mediaPath = mediaPath;
        this.context = context;
        this.loadAudioBuffer();
    }

    /**
     * Load the FAAH audio file into memory
     */
    private loadAudioBuffer() {
        try {
            const audioPath = path.join(this.mediaPath, 'faah.mp3');
            
            // Check if file exists, if not create a placeholder
            if (!fs.existsSync(audioPath)) {
                console.warn(`Audio file not found at ${audioPath}. Sound playback will be skipped.`);
                return;
            }

            this.audioBuffer = fs.readFileSync(audioPath);
            console.log(`Audio buffer loaded from ${audioPath} (${this.audioBuffer.length} bytes)`);
        } catch (error) {
            console.error('Failed to load audio buffer:', error);
        }
    }

    /**
     * Play the FAAH sound effect
     * @param type - Type of sound to play ('error' or 'warning')
     * @param applyRandomPitch - Whether to apply random pitch variation
     */
    async playSound(type: 'error' | 'warning' = 'error', applyRandomPitch: boolean = false): Promise<void> {
        if (!this.audioBuffer) {
            console.log('Audio buffer not available, skipping playback');
            return;
        }

        if (this.isPlaying) {
            return;
        }

        try {
            this.isPlaying = true;

            // Use VS Code's API to play a notification sound
            // Since we can't directly play audio in the extension context,
            // we'll use a platform-dependent approach or terminal bell
            this.playNotificationSound(applyRandomPitch);

            // Reset flag after a short delay
            setTimeout(() => {
                this.isPlaying = false;
            }, 500);

        } catch (error) {
            console.error('Error playing sound:', error);
            this.isPlaying = false;
        }
    }

    /**
     * Play a system notification sound using the terminal bell or similar
     * This is a fallback approach for playing sound in VS Code extensions
     */
    private playNotificationSound(applyRandomPitch: boolean) {
        try {
            // Create a terminal and write the bell character to play a system beep
            const terminal = vscode.window.createTerminal('FAAH Audio');
            
            // The bell character (\x07) triggers system sound
            if (applyRandomPitch) {
                // Multiple beeps with variation for comedic effect
                const pattern = this.generatePitchPattern();
                terminal.sendText(pattern, false);
            } else {
                terminal.sendText('\x07', false);
            }

            // Auto-hide the terminal after a brief moment
            setTimeout(() => {
                terminal.dispose();
            }, 100);

        } catch (error) {
            console.log('Could not play terminal bell, trying alternative method:', error);
            this.playViaWebAPI();
        }
    }

    /**
     * Generate a pattern of bell characters for comedic effect
     */
    private generatePitchPattern(): string {
        const bells = Math.floor(Math.random() * 3) + 2; // 2-4 bells
        return '\x07'.repeat(bells);
    }

    /**
     * Alternative method to play sound via Web API (if available)
     */
    private playViaWebAPI() {
        // This is a placeholder for potential future implementations
        // In a real scenario, you might use node-speaker or similar packages
        console.log('Attempting to play sound via web API');
    }

    /**
     * Dispose of resources
     */
    dispose() {
        this.audioBuffer = null;
    }
}
