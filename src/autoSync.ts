import * as vscode from 'vscode';
import { AgentInstructionSyncService } from './agentSync';
import { WorkspaceIndexer } from './workspace';
import { ContextStore } from './contextStore';

/**
 * AutoSyncService — Strategy 1: "Smart Context Injection"
 *
 * Yeh service workspace mein har file save, create, ya delete hone par
 * silently background mein CLAUDE.md / AGENTS.md / .cursor/rules/ files
 * ko latest workspace context se update karti hai.
 *
 * User ko kuch karne ki zaroorat nahi — Claude Code, Cursor, Antigravity
 * ko automatically updated context milta rehta hai.
 */
export class AutoSyncService {
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private statusBarItem: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];

    // Kitni der baad sync karna hai (default 30 sec), taaki har
    // keystroke par sync na ho
    private readonly DEFAULT_DEBOUNCE_MS = 30_000;

    constructor(private readonly context: vscode.ExtensionContext) {
        // Status bar mein ContextForge ka icon dikhao (bottom-right)
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.text = '$(sync) CF';
        this.statusBarItem.tooltip = 'ContextForge: Auto-sync active. Click to open Refiner.';
        this.statusBarItem.command = 'contextforge.openPromptRefiner';
        this.statusBarItem.backgroundColor = undefined;
    }

    /**
     * Service start karo. Agar auto-sync settings mein disable hai
     * toh kuch nahi karega.
     */
    public start(): void {
        const config = vscode.workspace.getConfiguration('contextforge');
        const isEnabled = config.get<boolean>('autoSync.enabled', true);
        if (!isEnabled) { return; }

        this.statusBarItem.show();

        // ── File Save hone par sync schedule karo ──────────────────────
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc) => {
                // Sirf workspace ki files par react karo, extension ki apni
                // files par nahi (infinite loop se bachao)
                if (this.isWorkspaceFile(doc.uri)) {
                    this.scheduleSync(`Saved: ${this.shortName(doc.uri)}`);
                }
            })
        );

        // ── Nai files banne par ────────────────────────────────────────
        this.disposables.push(
            vscode.workspace.onDidCreateFiles((e) => {
                if (e.files.length > 0) {
                    this.scheduleSync(`${e.files.length} file(s) created`);
                }
            })
        );

        // ── Files delete hone par ──────────────────────────────────────
        this.disposables.push(
            vscode.workspace.onDidDeleteFiles((e) => {
                if (e.files.length > 0) {
                    this.scheduleSync(`${e.files.length} file(s) deleted`);
                }
            })
        );

        // ── Workspace folder change hone par ──────────────────────────
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.scheduleSync('Workspace changed', 3_000);
            })
        );

        // ── Extension activate hone par ek baar sync karo (5 sec delay)
        this.scheduleSync('Startup', 5_000);
    }

    /**
     * Sync ko debounce karo. Agar baar baar changes aa rahe hain toh
     * timer reset hota rahega aur sirf ek baar sync hoga.
     */
    private scheduleSync(reason: string, customDelayMs?: number): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        const config = vscode.workspace.getConfiguration('contextforge');
        const delaySeconds = config.get<number>('autoSync.delaySeconds', 30);
        const delay = customDelayMs ?? delaySeconds * 1_000;

        // Spinning icon — sync scheduled
        this.statusBarItem.text = '$(sync~spin) CF';
        this.statusBarItem.tooltip = `ContextForge: Sync scheduled in ${Math.round(delay / 1000)}s (${reason})`;

        this.debounceTimer = setTimeout(async () => {
            await this.performSync();
        }, delay);
    }

    /**
     * Asli sync logic. Workspace scan karo, agent files update karo.
     */
    private async performSync(): Promise<void> {
        if (!vscode.workspace.workspaceFolders?.length) { return; }

        this.statusBarItem.text = '$(sync~spin) CF';
        this.statusBarItem.tooltip = 'ContextForge: Syncing context to agent files...';

        try {
            const indexer = new WorkspaceIndexer();
            const summary = await indexer.summarizeWorkspace();
            const gitContext = indexer.getRecentGitContext();
            const rules = indexer.getProjectRules();

            // Context Store se last refined prompt lo (agar koi hai toh)
            const store = new ContextStore();
            const lastPrompt = store.getLastRefinedPrompt()
                || 'No active task yet. Use ContextForge (Ctrl+Shift+P → ContextForge: Open Prompt Refiner) to refine a prompt first.';

            // Full context build karo
            const fullContext = gitContext
                ? `${summary}\n\n--- Recent Git Activity ---\n${gitContext}`
                : summary;

            const contextBlock = rules
                ? `${fullContext}\n\n--- Project Rules ---\n${rules}`
                : fullContext;

            // Agent files mein silently sync karo (no popup)
            const syncService = new AgentInstructionSyncService();
            await syncService.syncQuiet(lastPrompt, contextBlock);

            // Success icon
            this.statusBarItem.text = '$(check) CF';
            this.statusBarItem.tooltip = `ContextForge: Context synced ✓ at ${new Date().toLocaleTimeString()}`;

            // 4 sec baad wapas normal icon
            setTimeout(() => {
                this.statusBarItem.text = '$(sync) CF';
                this.statusBarItem.tooltip = 'ContextForge: Auto-sync active. Click to open Refiner.';
            }, 4_000);

        } catch (err: any) {
            this.statusBarItem.text = '$(warning) CF';
            this.statusBarItem.tooltip = `ContextForge: Auto-sync failed — ${err.message}`;
        }
    }

    /**
     * Check karo ke file workspace ki hai ya extension ki internal file
     */
    private isWorkspaceFile(uri: vscode.Uri): boolean {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { return false; }
        // node_modules, .git, out, dist ke andar ki files ignore karo
        const rel = uri.fsPath.replace(root, '');
        const ignorePatterns = ['node_modules', '.git', '\\out\\', '/out/', '\\dist\\', '/dist/'];
        return !ignorePatterns.some(p => rel.includes(p));
    }

    /** Uri se sirf file name nikalo (logs ke liye) */
    private shortName(uri: vscode.Uri): string {
        return uri.fsPath.split(/[\\/]/).pop() || uri.fsPath;
    }

    public dispose(): void {
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
        this.disposables.forEach(d => d.dispose());
        this.statusBarItem.dispose();
    }
}
