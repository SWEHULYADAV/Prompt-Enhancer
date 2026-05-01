import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class ContextStore {
    private storagePath: string;

    constructor() {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this.storagePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.contextforge');
            if (!fs.existsSync(this.storagePath)) {
                fs.mkdirSync(this.storagePath, { recursive: true });
            }
        } else {
            this.storagePath = '';
        }
    }

    private getContextFile(): string {
        return path.join(this.storagePath, 'context.json');
    }

    private initFile() {
        if (!fs.existsSync(this.getContextFile())) {
            fs.writeFileSync(this.getContextFile(), JSON.stringify({ version: "1.0.0", summary: "", history: [] }, null, 2), 'utf8');
        }
    }

    public async saveSummary(summary: string) {
        if (!this.storagePath) {return;}
        this.initFile();
        const data = JSON.parse(fs.readFileSync(this.getContextFile(), 'utf8'));
        data.summary = summary;
        fs.writeFileSync(this.getContextFile(), JSON.stringify(data, null, 2), 'utf8');
    }

    public async appendHistory(prompt: string, refined: string) {
        if (!this.storagePath) {return;}
        this.initFile();
        const data = JSON.parse(fs.readFileSync(this.getContextFile(), 'utf8'));
        data.history.push({
            timestamp: new Date().toISOString(),
            prompt,
            refined
        });
        fs.writeFileSync(this.getContextFile(), JSON.stringify(data, null, 2), 'utf8');
    }

    public getLastRefinedPrompt(): string | undefined {
        if (!this.storagePath || !fs.existsSync(this.getContextFile())) {return undefined;}
        try {
            const data = JSON.parse(fs.readFileSync(this.getContextFile(), 'utf8'));
            if (data.history && data.history.length > 0) {
                return data.history[data.history.length - 1].refined;
            }
        } catch (e) {
            return undefined;
        }
        return undefined;
    }
}
