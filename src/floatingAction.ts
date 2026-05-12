import * as vscode from 'vscode';

/**
 * FloatingEnhanceProvider — Strategy 3: "Floating Wand Button"
 *
 * Jab bhi user VS Code editor mein text select kare (minimum 10 chars),
 * selected text ke upar ek "✨ Enhance with ContextForge" CodeLens button
 * appear hota hai. Click karne par selected text in-place enhance ho jata hai.
 *
 * Yeh RooCode ke prompt enhancer wand button jaisa feel deta hai.
 * Cursor aur Antigravity ke file editors mein bhi kaam karta hai.
 */
export class FloatingEnhanceProvider implements vscode.CodeLensProvider {
    private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    private currentSelection: vscode.Selection | undefined;
    private activeEditorUri: string | undefined;

    /**
     * Selection change hone par yeh method call hogi (extension.ts se)
     * CodeLens ko refresh karne ke liye fire karo
     */
    public updateSelection(
        editor: vscode.TextEditor | undefined,
        selection: vscode.Selection | undefined
    ): void {
        this.activeEditorUri = editor?.document.uri.toString();
        this.currentSelection = selection;
        this._onDidChangeCodeLenses.fire();
    }

    /**
     * VS Code yeh method call karta hai jab bhi CodeLenses refresh karni hoti hain.
     * Hum sirf tab lens return karte hain jab:
     * 1. Feature enabled ho
     * 2. Selection non-empty ho
     * 3. Selected text minimum 10 chars ka ho (bahut choti selection par na dikhe)
     */
    public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const config = vscode.workspace.getConfiguration('contextforge');
        if (!config.get<boolean>('floatingButton.enabled', true)) { return []; }

        // Sirf is document ke liye lens dikhao
        if (document.uri.toString() !== this.activeEditorUri) { return []; }

        // Selection check
        if (!this.currentSelection || this.currentSelection.isEmpty) { return []; }

        // Selected text
        const selectedText = document.getText(this.currentSelection);
        const trimmed = selectedText.trim();

        // Bahut choti selection par button mat dikhao
        if (trimmed.length < 10) { return []; }

        // Sirf agar text mein prompt-like cheez lagti ho
        // (numbers ya single words par na dikhao)
        if (!trimmed.includes(' ') && trimmed.length < 30) { return []; }

        // CodeLens selection ke start line par dikhao
        const range = new vscode.Range(
            this.currentSelection.start.line,
            0,
            this.currentSelection.start.line,
            0
        );

        // Wand button — selected text ko enhance karne ka command
        const enhanceLens = new vscode.CodeLens(range, {
            title: '✨ Enhance with ContextForge',
            command: 'contextforge.enhanceSelection',
            arguments: [selectedText, this.currentSelection],
            tooltip: 'Enhance this prompt with workspace context, web search, and AI refinement'
        });

        // Open in panel button (dusra option)
        const openLens = new vscode.CodeLens(range, {
            title: '$(edit) Open in Panel',
            command: 'contextforge.openPromptRefiner',
            arguments: [],
            tooltip: 'Open this text in ContextForge full panel'
        });

        return [enhanceLens, openLens];
    }

    /** Lens resolve karna zaroorat nahi kyunki command pehle se set hai */
    public resolveCodeLens(lens: vscode.CodeLens): vscode.CodeLens {
        return lens;
    }

    public dispose(): void {
        this._onDidChangeCodeLenses.dispose();
    }
}
