import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface AgentSyncResult {
    filePaths: string[];
    action: 'created' | 'updated';
}

export class AgentInstructionSyncService {
    private rootPath: string;
    private readonly startMarker = '<!-- contextforge:start -->';
    private readonly endMarker = '<!-- contextforge:end -->';

    constructor() {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this.rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        } else {
            this.rootPath = '';
        }
    }

    public async sync(refinedPrompt: string, summary: string, dryRun: boolean = false): Promise<AgentSyncResult[]> {
        if (!this.rootPath) { return []; }

        const files = [
            'AGENTS.md',
            'CLAUDE.md',
            'GEMINI.md',
            '.github/copilot-instructions.md',
            '.cursor/rules/contextforge.mdc',
            '.continue/rules/contextforge.md',
            '.agents/rules/contextforge.md' // Antigravity support
        ];

        const template = this.buildTemplate(refinedPrompt, summary);
        const results: AgentSyncResult[] = [];

        for (const relPath of files) {
            const fullPath = path.join(this.rootPath, relPath);
            const isNewFile = !fs.existsSync(fullPath);

            let initialContent = template;
            if (isNewFile && relPath.endsWith('.mdc')) {
                initialContent = `---\ndescription: ContextForge Generated Rules\nglobs: ["**/*"]\nalwaysApply: true\n---\n\n` + template;
            }

            if (dryRun) {
                results.push({ filePaths: [fullPath], action: isNewFile ? 'created' : 'updated' });
                continue;
            }

            try {
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                // Create Backup if modifying an existing file
                if (!isNewFile) {
                    const backupPath = `${fullPath}.contextforge.backup`;
                    fs.copyFileSync(fullPath, backupPath);
                }

                this.safeUpdateFile(fullPath, isNewFile ? initialContent : template);
                results.push({ filePaths: [fullPath], action: isNewFile ? 'created' : 'updated' });
            } catch (e: any) {
                vscode.window.showWarningMessage(`ContextForge: Could not sync ${relPath} — ${e.message}`);
            }
        }
        
        if (!dryRun) {
            vscode.window.showInformationMessage('Successfully synced ContextForge instructions to agent files.');
        }
        
        return results;
    }

    /**
     * syncQuiet — AutoSyncService ke liye.
     * sync() ki tarah hi kaam karta hai lekin koi success notification
     * nahi dikhata. Background mein silently context update karta hai.
     */
    public async syncQuiet(refinedPrompt: string, summary: string): Promise<AgentSyncResult[]> {
        if (!this.rootPath) { return []; }

        const files = [
            'AGENTS.md',
            'CLAUDE.md',
            'GEMINI.md',
            '.github/copilot-instructions.md',
            '.cursor/rules/contextforge.mdc',
            '.continue/rules/contextforge.md',
            '.agents/rules/contextforge.md'
        ];

        const template = this.buildTemplate(refinedPrompt, summary);
        const results: AgentSyncResult[] = [];

        for (const relPath of files) {
            const fullPath = path.join(this.rootPath, relPath);
            const isNewFile = !fs.existsSync(fullPath);

            let initialContent = template;
            if (isNewFile && relPath.endsWith('.mdc')) {
                initialContent = `---\ndescription: ContextForge Generated Rules\nglobs: ["**/*"]\nalwaysApply: true\n---\n\n` + template;
            }

            try {
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                if (!isNewFile) {
                    const backupPath = `${fullPath}.contextforge.backup`;
                    fs.copyFileSync(fullPath, backupPath);
                }

                this.safeUpdateFile(fullPath, isNewFile ? initialContent : template);
                results.push({ filePaths: [fullPath], action: isNewFile ? 'created' : 'updated' });
            } catch (e: any) {
                // Quiet mode mein sirf console log karo, popup nahi
                console.warn(`ContextForge AutoSync: Could not sync ${relPath} — ${e.message}`);
            }
        }

        return results;
    }

    public rollback(): string[] {
        if (!this.rootPath) {return [];}

        const files = [
            'AGENTS.md',
            'CLAUDE.md',
            'GEMINI.md',
            '.github/copilot-instructions.md',
            '.cursor/rules/contextforge.mdc',
            '.continue/rules/contextforge.md',
            '.agents/rules/contextforge.md'
        ];

        const restoredFiles: string[] = [];

        for (const relPath of files) {
            const fullPath = path.join(this.rootPath, relPath);
            const backupPath = `${fullPath}.contextforge.backup`;

            if (fs.existsSync(backupPath)) {
                try {
                    fs.copyFileSync(backupPath, fullPath);
                    fs.unlinkSync(backupPath); // Delete backup only after successful copy
                    restoredFiles.push(relPath);
                } catch (e: any) {
                    vscode.window.showWarningMessage(`ContextForge: Rollback failed for ${relPath} — ${e.message}`);
                }
            }
        }

        return restoredFiles;
    }

    private buildTemplate(prompt: string, summary: string): string {
        return `
${this.startMarker}
# ContextForge Global Instructions
This section is automatically managed by ContextForge. Do not edit manually.

## Workspace Summary
${summary}

## Active Task
${prompt}
${this.endMarker}
`;
    }

    private safeUpdateFile(filePath: string, newContent: string) {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, newContent, 'utf8');
            return;
        }

        const currentContent = fs.readFileSync(filePath, 'utf8');
        const startIndex = currentContent.indexOf(this.startMarker);
        const endIndex = currentContent.indexOf(this.endMarker);

        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
            const before = currentContent.substring(0, startIndex);
            const after = currentContent.substring(endIndex + this.endMarker.length);
            const merged = before + newContent.trim() + after;
            fs.writeFileSync(filePath, merged, 'utf8');
        } else {
            const merged = currentContent + '\n\n' + newContent.trim();
            fs.writeFileSync(filePath, merged, 'utf8');
        }
    }
}
