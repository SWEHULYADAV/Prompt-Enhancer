import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export class WorkspaceIndexer {
    private importantFiles = [
        'package.json', 'tsconfig.json', 'pyproject.toml', 
        'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 
        'build.gradle', 'Dockerfile', 'docker-compose.yml', 
        'README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 
        '.github/copilot-instructions.md'
    ];

    public async summarizeWorkspace(): Promise<string> {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return "No workspace open.";
        }

        const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        let summary = `Workspace Root: ${rootPath}\n\n`;

        summary += "Important Files Found:\n";
        for (const file of this.importantFiles) {
            const p = path.join(rootPath, file);
            if (fs.existsSync(p)) {
                summary += `- ${file}\n`;
                if (file === 'package.json') {
                    try {
                        const content = JSON.parse(await fs.promises.readFile(p, 'utf8'));
                        if (content.dependencies) {
                            summary += `  Dependencies: ${Object.keys(content.dependencies).slice(0, 10).join(', ')}...\n`;
                        }
                    } catch (e) {}
                }
            }
        }

        summary += "\nDirectory Structure (Top Level):\n";
        try {
            const uris = await vscode.workspace.findFiles('**/*', undefined, 100);
            const dirs = new Set<string>();
            for (const uri of uris) {
                const relative = path.relative(rootPath, uri.fsPath);
                const parts = relative.split(path.sep);
                if (parts.length > 0) {
                    dirs.add(parts[0]);
                }
            }
            for (const dir of Array.from(dirs).sort()) {
                summary += `- ${dir}\n`;
            }
        } catch(e) {}

        return summary;
    }

    /** Returns recent git activity for this specific workspace. Safe — returns empty string if no git repo. */
    public getRecentGitContext(): string {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return '';
        }
        const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const opts = { cwd: rootPath, timeout: 5000 };

        try {
            // Verify it's a git repo
            execSync('git rev-parse --git-dir', opts);
        } catch {
            return ''; // Not a git repo — silently skip
        }

        let context = '';
        try {
            const log = execSync('git log --oneline -5', opts).toString().trim();
            if (log) { context += `Recent Commits (last 5):\n${log}\n\n`; }
        } catch { /* ignore */ }

        try {
            const diffStat = execSync('git diff HEAD --stat', opts).toString().trim();
            if (diffStat) { context += `Uncommitted Changes (stat):\n${diffStat}\n\n`; }
        } catch { /* ignore */ }

        try {
            const staged = execSync('git diff --cached --stat', opts).toString().trim();
            if (staged) { context += `Staged Changes:\n${staged}\n`; }
        } catch { /* ignore */ }

        return context;
    }
}
