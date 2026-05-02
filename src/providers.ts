import * as vscode from 'vscode';
import * as https from 'https';
import { 
    HealthCheckResult, JsonSchema, LlmJsonRequest, LlmProvider, LlmTextRequest, 
    NativeProviderConfig, CustomOpenAiProviderConfig, GenericHttpProviderConfig, ProviderConfig 
} from './types';
import { ProviderConfigManager } from './providerConfig';

export class AnthropicProvider implements LlmProvider {
    id: string;
    displayName: string;
    private config: NativeProviderConfig;

    constructor(config: NativeProviderConfig) {
        this.config = config;
        this.id = config.id;
        this.displayName = config.displayName;
    }

    async isConfigured(context: vscode.ExtensionContext): Promise<boolean> {
        const key = await ProviderConfigManager.getApiKey(context, this.config.id);
        return !!key;
    }

    private async makeRequest(system: string | undefined, user: string, maxTokens: number, temperature: number, context: vscode.ExtensionContext): Promise<string> {
        const apiKey = await ProviderConfigManager.getApiKey(context, this.config.id);
        if (!apiKey) {throw new Error("Anthropic API key not configured.");}

        const body: any = {
            model: this.config.model || 'claude-3-5-sonnet-20240620',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            max_tokens: maxTokens,
            temperature: temperature,
            messages: [{ role: 'user', content: user }]
        };

        if (system) {
            body.system = system;
        }

        return new Promise((resolve, reject) => {
            const req = https.request('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                },
                timeout: 30000
            }, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(parsed.content[0].text);
                        } catch (e) {
                            reject(new Error("Failed to parse JSON response: " + data.substring(0, 100)));
                        }
                    } else if (res.statusCode === 401 || res.statusCode === 403) {
                        reject(new Error(`API Error ${res.statusCode}: Invalid API Key.`));
                    } else if (res.statusCode === 429) {
                        reject(new Error(`API Error 429: Rate limited.`));
                    } else {
                        reject(new Error(`API Error ${res.statusCode}: ${data.substring(0, 100)}`));
                    }
                });
            });

            req.on('error', err => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timed out.'));
            });
            req.write(JSON.stringify(body));
            req.end();
        });
    }

    async generateJson<T>(request: LlmJsonRequest, schema: JsonSchema, context: vscode.ExtensionContext): Promise<T> {
        const sys = request.system ? request.system + "\n\nYou must respond only with valid JSON." : "You must respond only with valid JSON.";
        const content = await this.makeRequest(sys, request.prompt, 4000, 0.1, context);
        try {
            let jsonStr = content;
            if (jsonStr.includes('\`\`\`json')) {
                jsonStr = jsonStr.split('\`\`\`json')[1].split('\`\`\`')[0].trim();
            }
            return JSON.parse(jsonStr) as T;
        } catch (e) {
            throw new Error("Anthropic provider did not return valid JSON: " + content);
        }
    }

    async generateText(request: LlmTextRequest, context: vscode.ExtensionContext): Promise<string> {
        return await this.makeRequest(request.system, request.prompt, 4000, 0.2, context);
    }

    async generateTextStream(request: LlmTextRequest, context: vscode.ExtensionContext, onToken: (token: string) => void): Promise<string> {
        const apiKey = await ProviderConfigManager.getApiKey(context, this.config.id);
        if (!apiKey) {throw new Error("Anthropic API key not configured.");}

        const body: any = {
            model: this.config.model || 'claude-3-5-sonnet-20240620',
            max_tokens: 4000,
            temperature: 0.2,
            messages: [{ role: 'user', content: request.prompt }],
            stream: true
        };
        if (request.system) { body.system = request.system; }

        return new Promise((resolve, reject) => {
            let fullText = '';
            const req = https.request('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                },
                timeout: 30000
            }, res => {
                let buffer = '';
                res.on('data', chunk => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.substring(6).trim();
                            if (data === '[DONE]') {continue;}
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                                    const token = parsed.delta.text;
                                    fullText += token;
                                    onToken(token);
                                }
                            } catch (e) {}
                        }
                    }
                });
                res.on('end', () => resolve(fullText));
            });
            req.on('error', err => reject(err));
            req.write(JSON.stringify(body));
            req.end();
        });
    }

    async healthCheck(context: vscode.ExtensionContext): Promise<HealthCheckResult> {
        try {
            const content = await this.makeRequest(undefined, "Reply with OK only.", 8, 0, context);
            if (content && content.toUpperCase().includes('OK')) {
                return { status: 'working', message: 'API is working.' };
            }
            return { status: 'unexpected_response', message: `API reachable but unexpected response: ${content}` };
        } catch (e: any) {
            const msg = e.message.toLowerCase();
            if (msg.includes('invalid api key') || msg.includes('401')) {return { status: 'invalid_key', message: 'Invalid API Key.' };}
            if (msg.includes('rate limit') || msg.includes('429')) {return { status: 'rate_limited', message: 'Rate limited.' };}
            if (msg.includes('timed out')) {return { status: 'timeout', message: 'Request timed out.' };}
            if (msg.includes('getaddrinfo') || msg.includes('econnrefused')) {return { status: 'invalid_url', message: 'Invalid URL or host unreachable.' };}
            return { status: 'unexpected_response', message: e.message };
        }
    }
}

export class GeminiProvider implements LlmProvider {
    id: string;
    displayName: string;
    private config: NativeProviderConfig;

    constructor(config: NativeProviderConfig) {
        this.config = config;
        this.id = config.id;
        this.displayName = config.displayName;
    }

    async isConfigured(context: vscode.ExtensionContext): Promise<boolean> {
        const key = await ProviderConfigManager.getApiKey(context, this.config.id);
        return !!key;
    }

    private async makeRequest(system: string | undefined, user: string, maxTokens: number, temperature: number, context: vscode.ExtensionContext, schema?: JsonSchema): Promise<string> {
        const apiKey = await ProviderConfigManager.getApiKey(context, this.config.id);
        if (!apiKey) {throw new Error("Gemini API key not configured.");}

        const model = this.config.model || 'gemini-1.5-flash';
        const urlStr = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        const body: any = {
            contents: [{ parts: [{ text: user }] }],
            generationConfig: {
                temperature: temperature,
                maxOutputTokens: maxTokens
            }
        };

        if (system) {
            body.systemInstruction = { parts: [{ text: system }] };
        }

        if (schema) {
            body.generationConfig.responseMimeType = "application/json";
            body.generationConfig.responseSchema = schema;
        }

        return new Promise((resolve, reject) => {
            const url = new URL(urlStr);
            const req = https.request(url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey 
                },
                timeout: 30000
            }, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.candidates && parsed.candidates[0].content.parts[0].text) {
                                resolve(parsed.candidates[0].content.parts[0].text);
                            } else {
                                reject(new Error("Unexpected response structure from Gemini."));
                            }
                        } catch (e) {
                            reject(new Error("Failed to parse JSON response."));
                        }
                    } else if (res.statusCode === 401 || res.statusCode === 403) {
                        reject(new Error(`API Error ${res.statusCode}: Invalid API Key.`));
                    } else if (res.statusCode === 429) {
                        reject(new Error(`API Error 429: Rate limited.`));
                    } else {
                        reject(new Error(`API Error ${res.statusCode}: ${data.substring(0, 100)}`));
                    }
                });
            });

            req.on('error', err => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timed out.'));
            });
            req.write(JSON.stringify(body));
            req.end();
        });
    }

    async generateJson<T>(request: LlmJsonRequest, schema: JsonSchema, context: vscode.ExtensionContext): Promise<T> {
        const content = await this.makeRequest(request.system, request.prompt, 4000, 0.1, context, schema);
        return JSON.parse(content) as T;
    }

    async generateText(request: LlmTextRequest, context: vscode.ExtensionContext): Promise<string> {
        return await this.makeRequest(request.system, request.prompt, 4000, 0.2, context);
    }

    async generateTextStream(request: LlmTextRequest, context: vscode.ExtensionContext, onToken: (token: string) => void): Promise<string> {
        const apiKey = await ProviderConfigManager.getApiKey(context, this.config.id);
        if (!apiKey) {throw new Error("Gemini API key not configured.");}

        const model = this.config.model || 'gemini-1.5-flash';
        const urlStr = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;

        const body: any = {
            contents: [{ parts: [{ text: request.prompt }] }],
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
            }
        };
        if (request.system) { body.systemInstruction = { parts: [{ text: request.system }] }; }

        return new Promise((resolve, reject) => {
            let fullText = '';
            const url = new URL(urlStr);
            const req = https.request(url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey 
                },
                timeout: 30000
            }, res => {
                let buffer = '';
                res.on('data', chunk => {
                    buffer += chunk.toString();
                    let searchPos = 0;
                    while (true) {
                        const startIdx = buffer.indexOf('{"candidates"', searchPos);
                        if (startIdx === -1) break;
                        
                        let endIdx = buffer.indexOf('}\n', startIdx);
                        if (endIdx === -1) endIdx = buffer.indexOf('},', startIdx);
                        if (endIdx === -1) endIdx = buffer.lastIndexOf('}');
                        
                        if (endIdx > startIdx) {
                            try {
                                const jsonStr = buffer.substring(startIdx, endIdx + 1);
                                const parsed = JSON.parse(jsonStr);
                                if (parsed.candidates && parsed.candidates[0].content.parts[0].text) {
                                    const token = parsed.candidates[0].content.parts[0].text;
                                    fullText += token;
                                    onToken(token);
                                }
                                buffer = buffer.substring(endIdx + 1);
                                searchPos = 0;
                            } catch (e) {
                                searchPos = startIdx + 1;
                                break;
                            }
                        } else {
                            break;
                        }
                    }
                });
                res.on('end', () => resolve(fullText));
            });
            req.on('error', err => reject(err));
            req.write(JSON.stringify(body));
            req.end();
        });
    }

    async healthCheck(context: vscode.ExtensionContext): Promise<HealthCheckResult> {
        try {
            const content = await this.makeRequest(undefined, "Reply with OK only.", 8, 0, context);
            if (content && content.toUpperCase().includes('OK')) {
                return { status: 'working', message: 'API is working.' };
            }
            return { status: 'unexpected_response', message: `API reachable but unexpected response: ${content}` };
        } catch (e: any) {
            const msg = e.message.toLowerCase();
            if (msg.includes('invalid api key') || msg.includes('401') || msg.includes('403')) {return { status: 'invalid_key', message: 'Invalid API Key.' };}
            if (msg.includes('rate limit') || msg.includes('429')) {return { status: 'rate_limited', message: 'Rate limited.' };}
            if (msg.includes('timed out')) {return { status: 'timeout', message: 'Request timed out.' };}
            if (msg.includes('not found') || msg.includes('404')) {return { status: 'invalid_model', message: 'Model not found.' };}
            return { status: 'unexpected_response', message: e.message };
        }
    }
}

export class GenericHttpProvider implements LlmProvider {
    id: string;
    displayName: string;
    private config: GenericHttpProviderConfig;

    constructor(config: GenericHttpProviderConfig) {
        this.config = config;
        this.id = config.id;
        this.displayName = config.displayName;
    }

    async isConfigured(context: vscode.ExtensionContext): Promise<boolean> {
        const key = await ProviderConfigManager.getApiKey(context, this.config.id);
        if (this.config.headersTemplate && JSON.stringify(this.config.headersTemplate).includes('{{apiKey}}') && !key) {
            return false;
        }
        if (this.config.bodyTemplate && this.config.bodyTemplate.includes('{{apiKey}}') && !key) {
            return false;
        }
        return true;
    }

    private async renderTemplate(template: string, vars: Record<string, string>): Promise<string> {
        let result = template;
        for (const [k, v] of Object.entries(vars)) {
            const search = `{{${k}}}`;
            result = result.split(search).join(v);
        }
        return result;
    }

    private extractResponsePath(obj: any, path: string): any {
        if (!path) {return obj;}
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
            if (current === undefined || current === null) {return undefined;}
            current = current[part];
        }
        return current;
    }

    private async makeRequest(system: string | undefined, user: string, maxTokens: number, temperature: number, context: vscode.ExtensionContext): Promise<string> {
        const apiKey = await ProviderConfigManager.getApiKey(context, this.config.id) || '';
        
        const escapeStr = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        
        const vars = {
            apiKey: apiKey,
            model: this.config.model,
            systemPrompt: system ? escapeStr(system) : '',
            userPrompt: escapeStr(user),
            maxTokens: maxTokens.toString(),
            temperature: temperature.toString()
        };

        const headersStr = await this.renderTemplate(JSON.stringify(this.config.headersTemplate || {}), vars);
        const bodyStr = await this.renderTemplate(this.config.bodyTemplate, vars);

        return new Promise((resolve, reject) => {
            const url = new URL(this.config.url);
            const req = https.request(url, {
                method: this.config.method,
                headers: JSON.parse(headersStr),
                timeout: 30000
            }, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            const content = this.extractResponsePath(parsed, this.config.responseTextPath);
                            if (content === undefined || content === null) {
                                reject(new Error(`Failed to extract text using path '${this.config.responseTextPath}'. Response was: ${data.substring(0, 100)}`));
                            } else {
                                resolve(content.toString());
                            }
                        } catch (e) {
                            if (!this.config.responseTextPath) {
                                resolve(data);
                            } else {
                                reject(new Error("Failed to parse JSON response: " + data.substring(0, 100)));
                            }
                        }
                    } else if (res.statusCode === 401 || res.statusCode === 403) {
                        reject(new Error(`API Error ${res.statusCode}: Invalid API Key or Unauthorized.`));
                    } else if (res.statusCode === 429) {
                        reject(new Error(`API Error 429: Rate limited.`));
                    } else {
                        reject(new Error(`API Error ${res.statusCode}: ${data.substring(0, 100)}`));
                    }
                });
            });

            req.on('error', err => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timed out.'));
            });
            req.write(bodyStr);
            req.end();
        });
    }

    async generateJson<T>(request: LlmJsonRequest, schema: JsonSchema, context: vscode.ExtensionContext): Promise<T> {
        const sys = request.system ? request.system + "\n\nMust output valid JSON matching the required schema." : "Must output valid JSON.";
        const content = await this.makeRequest(sys, request.prompt, 4000, 0.1, context);
        try {
            let jsonStr = content;
            if (jsonStr.includes('\`\`\`json')) {
                jsonStr = jsonStr.split('\`\`\`json')[1].split('\`\`\`')[0].trim();
            }
            return JSON.parse(jsonStr) as T;
        } catch (e) {
            throw new Error("Generic provider did not return valid JSON: " + content);
        }
    }

    async generateText(request: LlmTextRequest, context: vscode.ExtensionContext): Promise<string> {
        return await this.makeRequest(request.system, request.prompt, 4000, 0.2, context);
    }

    async healthCheck(context: vscode.ExtensionContext): Promise<HealthCheckResult> {
        try {
            const content = await this.makeRequest(undefined, "Reply with OK only.", 8, 0, context);
            if (content && content.toUpperCase().includes('OK')) {
                return { status: 'working', message: 'API is working.' };
            }
            return { status: 'unexpected_response', message: `API reachable but unexpected response: ${content}` };
        } catch (e: any) {
            const msg = e.message.toLowerCase();
            if (msg.includes('extract text using path')) {return { status: 'invalid_response_path', message: e.message };}
            if (msg.includes('unauthorized') || msg.includes('401')) {return { status: 'invalid_key', message: 'Invalid API Key.' };}
            if (msg.includes('rate limit') || msg.includes('429')) {return { status: 'rate_limited', message: 'Rate limited.' };}
            if (msg.includes('timed out')) {return { status: 'timeout', message: 'Request timed out.' };}
            if (msg.includes('getaddrinfo') || msg.includes('econnrefused')) {return { status: 'invalid_url', message: 'Invalid URL or host unreachable.' };}
            return { status: 'unexpected_response', message: e.message };
        }
    }
}

export class CustomOpenAiProvider implements LlmProvider {
    id: string;
    displayName: string;
    private config: CustomOpenAiProviderConfig;

    constructor(config: CustomOpenAiProviderConfig) {
        this.config = config;
        this.id = config.id;
        this.displayName = config.displayName;
    }

    async isConfigured(context: vscode.ExtensionContext): Promise<boolean> {
        if (this.config.authType !== 'none') {
            const key = await ProviderConfigManager.getApiKey(context, this.config.id);
            if (!key) {return false;}
        }
        return true;
    }

    private async getHeaders(context: vscode.ExtensionContext): Promise<Record<string, string>> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.config.authType !== 'none') {
            const key = await ProviderConfigManager.getApiKey(context, this.config.id);
            if (key) {
                if (this.config.authType === 'bearer') {
                    headers['Authorization'] = `Bearer ${key}`;
                } else if (this.config.authType === 'x-api-key') {
                    headers['x-api-key'] = key;
                }
            }
        }
        return headers;
    }

    private makeRequest<T>(urlStr: string, headers: Record<string, string>, body: any, timeoutMs: number = 30000): Promise<T> {
        return new Promise((resolve, reject) => {
            const url = new URL(urlStr);
            const req = https.request(url, {
                method: 'POST',
                headers,
                timeout: timeoutMs
            }, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error("Failed to parse response: " + data.substring(0, 100)));
                        }
                    } else if (res.statusCode === 401 || res.statusCode === 403) {
                        reject(new Error(`API Error ${res.statusCode}: Invalid API Key or Unauthorized.`));
                    } else if (res.statusCode === 429) {
                        reject(new Error(`API Error 429: Rate limited.`));
                    } else {
                        reject(new Error(`API Error ${res.statusCode}: ${data.substring(0, 100)}`));
                    }
                });
            });

            req.on('error', err => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timed out.'));
            });
            req.write(JSON.stringify(body));
            req.end();
        });
    }

    async generateJson<T>(request: LlmJsonRequest, schema: JsonSchema, context: vscode.ExtensionContext): Promise<T> {
        const headers = await this.getHeaders(context);
        const url = `${this.config.baseUrl}${this.config.endpointPath || '/chat/completions'}`;
        
        const messages = [];
        if (request.system) {
            messages.push({ role: 'system', content: request.system });
        }
        messages.push({ role: 'user', content: request.prompt });

        const body = {
            model: this.config.model,
            messages,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            response_format: { type: "json_object" },
            temperature: 0.1
        };

        const response: any = await this.makeRequest(url, headers, body);
        const content = response.choices?.[0]?.message?.content;
        if (!content) {throw new Error("Invalid response format from OpenAI-compatible API.");}
        return JSON.parse(content) as T;
    }

    async generateText(request: LlmTextRequest, context: vscode.ExtensionContext): Promise<string> {
        const headers = await this.getHeaders(context);
        const url = `${this.config.baseUrl}${this.config.endpointPath || '/chat/completions'}`;
        
        const messages = [];
        if (request.system) {
            messages.push({ role: 'system', content: request.system });
        }
        messages.push({ role: 'user', content: request.prompt });

        const body = {
            model: this.config.model,
            messages,
            temperature: 0.2
        };

        const response: any = await this.makeRequest(url, headers, body);
        const content = response.choices?.[0]?.message?.content;
        if (!content) {throw new Error("Invalid response format from OpenAI-compatible API.");}
        return content;
    }

    async generateTextStream(request: LlmTextRequest, context: vscode.ExtensionContext, onToken: (token: string) => void): Promise<string> {
        const headers = await this.getHeaders(context);
        const urlStr = `${this.config.baseUrl}${this.config.endpointPath || '/chat/completions'}`;
        
        const messages = [];
        if (request.system) {
            messages.push({ role: 'system', content: request.system });
        }
        messages.push({ role: 'user', content: request.prompt });

        const body = {
            model: this.config.model,
            messages,
            temperature: 0.2,
            stream: true
        };

        return new Promise((resolve, reject) => {
            let fullText = '';
            const url = new URL(urlStr);
            const req = https.request(url, {
                method: 'POST',
                headers,
                timeout: 30000
            }, res => {
                let buffer = '';
                res.on('data', chunk => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.substring(6).trim();
                            if (data === '[DONE]') {continue;}
                            try {
                                const parsed = JSON.parse(data);
                                const token = parsed.choices?.[0]?.delta?.content || "";
                                if (token) {
                                    fullText += token;
                                    onToken(token);
                                }
                            } catch (e) {}
                        }
                    }
                });
                res.on('end', () => resolve(fullText));
            });
            req.on('error', err => reject(err));
            req.write(JSON.stringify(body));
            req.end();
        });
    }

    async healthCheck(context: vscode.ExtensionContext): Promise<HealthCheckResult> {
        try {
            const headers = await this.getHeaders(context);
            const url = `${this.config.baseUrl}${this.config.endpointPath || '/chat/completions'}`;
            
            const body = {
                model: this.config.model,
                messages: [{ role: 'user', content: 'Reply with OK only.' }],
                // eslint-disable-next-line @typescript-eslint/naming-convention
                max_tokens: 8,
                temperature: 0
            };

            const response: any = await this.makeRequest(url, headers, body, 20000);
            const content = response.choices?.[0]?.message?.content;
            
            if (content && content.toUpperCase().includes('OK')) {
                return { status: 'working', message: 'API is working.' };
            }
            return { status: 'unexpected_response', message: `API reachable but unexpected response: ${content}` };
        } catch (e: any) {
            const msg = e.message.toLowerCase();
            if (msg.includes('unauthorized') || msg.includes('401')) {return { status: 'invalid_key', message: 'Invalid API Key.' };}
            if (msg.includes('rate limit') || msg.includes('429')) {return { status: 'rate_limited', message: 'Rate limited.' };}
            if (msg.includes('timed out')) {return { status: 'timeout', message: 'Request timed out.' };}
            if (msg.includes('getaddrinfo') || msg.includes('econnrefused')) {return { status: 'invalid_url', message: 'Invalid URL or host unreachable.' };}
            return { status: 'unexpected_response', message: e.message };
        }
    }
}

export class ProviderFactory {
    public static async getProvider(): Promise<LlmProvider> {
        const config = await ProviderConfigManager.getActiveProviderConfig();
        if (!config) {
            throw new Error("No active provider configured.");
        }
        return this.createProviderFromConfig(config);
    }

    public static createProviderFromConfig(config: ProviderConfig): LlmProvider {
        switch (config.type) {
            case 'native':
                if (config.adapterId === 'gemini') {
                    return new GeminiProvider(config as NativeProviderConfig);
                } else if (config.adapterId === 'anthropic') {
                    return new AnthropicProvider(config as NativeProviderConfig);
                }
                throw new Error(`Unknown native adapter: ${config.adapterId}`);
            case 'openai-compatible':
                return new CustomOpenAiProvider(config as CustomOpenAiProviderConfig);
            case 'generic-http':
                return new GenericHttpProvider(config as GenericHttpProviderConfig);
            default:
                throw new Error(`Unknown provider type`);
        }
    }
}
