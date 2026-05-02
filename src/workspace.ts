import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

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
            const uris = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**}', 100);
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
        const opts: any = { cwd: rootPath, timeout: 5000, encoding: 'utf8' };

        try {
            // Verify it's a git repo
            const res = spawnSync('git', ['rev-parse', '--git-dir'], opts);
            if (res.error || res.status !== 0) return '';
        } catch {
            return ''; // Not a git repo — silently skip
        }

        let context = '';
        try {
            const logRes = spawnSync('git', ['log', '--oneline', '-5'], opts);
            if (!logRes.error && logRes.status === 0) {
                const log = logRes.stdout.trim();
                if (log) { context += `Recent Commits (last 5):\n${log}\n\n`; }
            }
        } catch { /* ignore */ }

        try {
            const diffStatRes = spawnSync('git', ['diff', 'HEAD', '--stat'], opts);
            if (!diffStatRes.error && diffStatRes.status === 0) {
                const diffStat = diffStatRes.stdout.trim();
                if (diffStat) { context += `Uncommitted Changes (stat):\n${diffStat}\n\n`; }
            }
        } catch { /* ignore */ }

        try {
            const stagedRes = spawnSync('git', ['diff', '--cached', '--stat'], opts);
            if (!stagedRes.error && stagedRes.status === 0) {
                const staged = stagedRes.stdout.trim();
                if (staged) { context += `Staged Changes:\n${staged}\n`; }
            }
        } catch { /* ignore */ }

        return context;
    }

    /**
     * Reads `.contextforge/rules.md` from the workspace root.
     * Returns rules content as a string, or empty string if file doesn't exist.
     */
    public getProjectRules(): string {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return '';
        }
        const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const rulesPath = path.join(rootPath, '.contextforge', 'rules.md');
        try {
            if (fs.existsSync(rulesPath)) {
                return fs.readFileSync(rulesPath, 'utf8').trim();
            }
        } catch { /* silently skip */ }
        return '';
    }
}
