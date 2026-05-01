import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProviderConfig, WorkspaceProviderState } from './types';

export class ProviderConfigManager {
    private static readonly FILE_NAME = 'providers.json';
    private static readonly EXAMPLE_FILE_NAME = 'providers.example.json';
    private static readonly DIR_NAME = '.contextforge';

    private static getWorkspaceDir(): string | undefined {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            return vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
        return undefined;
    }

    private static getConfigPath(): string | undefined {
        const root = this.getWorkspaceDir();
        if (!root) {return undefined;}
        return path.join(root, this.DIR_NAME, this.FILE_NAME);
    }

    private static getExamplePath(): string | undefined {
        const root = this.getWorkspaceDir();
        if (!root) {return undefined;}
        return path.join(root, this.DIR_NAME, this.EXAMPLE_FILE_NAME);
    }

    private static ensureDirExists() {
        const root = this.getWorkspaceDir();
        if (!root) {return;}
        const dir = path.join(root, this.DIR_NAME);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private static generateExampleFile() {
        const examplePath = this.getExamplePath();
        if (!examplePath || fs.existsSync(examplePath)) {return;}

        const exampleState: WorkspaceProviderState = {
            schemaVersion: 1,
            activeProviderId: "example-groq",
            providers: [
                {
                    id: "example-groq",
                    displayName: "Groq (Preset)",
                    type: "openai-compatible",
                    baseUrl: "https://api.groq.com/openai/v1",
                    endpointPath: "/chat/completions",
                    model: "llama3-70b-8192",
                    authType: "bearer"
                },
                {
                    id: "example-gemini",
                    displayName: "Gemini Built-in",
                    type: "native",
                    adapterId: "gemini",
                    model: "gemini-1.5-pro"
                }
            ]
        };

        this.ensureDirExists();
        fs.writeFileSync(examplePath, JSON.stringify(exampleState, null, 2), 'utf8');
    }

    public static async getWorkspaceState(): Promise<WorkspaceProviderState | undefined> {
        this.generateExampleFile(); // Ensure example exists

        const configPath = this.getConfigPath();
        if (!configPath || !fs.existsSync(configPath)) {
            return undefined;
        }

        try {
            const content = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(content) as WorkspaceProviderState;
        } catch (e) {
            console.error('Failed to parse providers.json', e);
            return undefined;
        }
    }

    public static async saveWorkspaceState(state: WorkspaceProviderState): Promise<void> {
        this.ensureDirExists();
        const configPath = this.getConfigPath();
        if (!configPath) {return;}

        fs.writeFileSync(configPath, JSON.stringify(state, null, 2), 'utf8');
    }

    public static async getActiveProviderConfig(): Promise<ProviderConfig | undefined> {
        const state = await this.getWorkspaceState();
        if (!state || !state.activeProviderId) {return undefined;}

        return state.providers.find(p => p.id === state.activeProviderId);
    }

    public static async setApiKey(context: vscode.ExtensionContext, providerId: string, key: string): Promise<void> {
        await context.secrets.store(`contextforge.provider.${providerId}.key`, key);
    }

    public static async getApiKey(context: vscode.ExtensionContext, providerId: string): Promise<string | undefined> {
        return await context.secrets.get(`contextforge.provider.${providerId}.key`);
    }

    public static async deleteApiKey(context: vscode.ExtensionContext, providerId: string): Promise<void> {
        await context.secrets.delete(`contextforge.provider.${providerId}.key`);
    }

    public static async exportConfig(): Promise<string> {
        const state = await this.getWorkspaceState();
        if (!state) {throw new Error("No provider config found to export.");}
        return JSON.stringify(state, null, 2);
    }

    public static async importConfig(jsonString: string): Promise<void> {
        try {
            const parsed = JSON.parse(jsonString) as WorkspaceProviderState;
            if (!parsed.schemaVersion || !parsed.providers) {
                throw new Error("Invalid schema");
            }
            await this.saveWorkspaceState(parsed);
        } catch (e: any) {
            throw new Error("Failed to import config: " + e.message);
        }
    }
}
