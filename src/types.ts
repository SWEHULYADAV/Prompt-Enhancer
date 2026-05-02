import * as vscode from 'vscode';

export interface JsonSchema {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
}

export interface LlmJsonRequest {
    prompt: string;
    system?: string;
}

export interface LlmTextRequest {
    prompt: string;
    system?: string;
}

export interface HealthCheckResult {
    status: 'working' | 'invalid_key' | 'invalid_model' | 'invalid_url' | 'invalid_response_path' | 'rate_limited' | 'timeout' | 'unexpected_response';
    message: string;
}

export type OnTokenCallback = (chunk: string) => void;

export interface LlmProvider {
    id: string;
    displayName: string;
    isConfigured(context: vscode.ExtensionContext): Promise<boolean>;
    generateJson<T>(request: LlmJsonRequest, schema: JsonSchema, context: vscode.ExtensionContext): Promise<T>;
    generateText(request: LlmTextRequest, context: vscode.ExtensionContext): Promise<string>;
    /** Optional: streaming version. Falls back to generateText if not implemented. */
    generateTextStream?(request: LlmTextRequest, context: vscode.ExtensionContext, onToken: OnTokenCallback): Promise<string>;
    healthCheck(context: vscode.ExtensionContext): Promise<HealthCheckResult>;
}

export type AuthType = 'bearer' | 'x-api-key' | 'none';
export type ProviderType = 'native' | 'openai-compatible' | 'generic-http';

export interface BaseProviderConfig {
    id: string;
    displayName: string;
    type: ProviderType;
    model: string;
}

export interface NativeProviderConfig extends BaseProviderConfig {
    type: 'native';
    adapterId: 'gemini' | 'anthropic';
}

export interface CustomOpenAiProviderConfig extends BaseProviderConfig {
    type: 'openai-compatible';
    baseUrl: string;
    endpointPath: string; // default '/chat/completions'
    authType: AuthType;
}

export interface GenericHttpProviderConfig extends BaseProviderConfig {
    type: 'generic-http';
    url: string;
    method: 'POST' | 'GET'; // usually POST
    headersTemplate: Record<string, string>;
    bodyTemplate: string; // JSON string with {{vars}}
    responseTextPath: string; // dot-notation
    apiKeyVariableName?: string; // default 'API_KEY'
}

export type ProviderConfig = NativeProviderConfig | CustomOpenAiProviderConfig | GenericHttpProviderConfig;

export interface WorkspaceProviderState {
    schemaVersion: number;
    activeProviderId: string;
    providers: ProviderConfig[];
}

export interface SearchResult {
    title: string;
    url: string;
    content?: string;
    engine?: string;
    score?: number;
    publishedDate?: string;
}

export interface SearchEvidence {
    query: string;
    results: SearchResult[];
    selectedSources: SearchResult[];
    summary: string;
    confidence: "low" | "medium" | "high";
}

export interface ContextForgeUiError {
    code: string;
    title: string;
    message: string;
    severity: "info" | "warning" | "error";
    source: "provider" | "searxng" | "workspace" | "contextStore" | "agentSync" | "pipeline" | "unknown";
    actionable: boolean;
    actions?: Array<{
        id: string;
        label: string;
    }>;
    details?: string;
}

export interface PipelineProgressEvent {
    step: "checkingProvider" | "checkingSearxng" | "scanningWorkspace" | "planningSearches" | "searchingWeb" | "checkingAmbiguity" | "askingQuestions" | "refiningPrompt" | "savingContext" | "ready";
    label: string;
    status: "pending" | "running" | "done" | "error";
    message?: string;
}
