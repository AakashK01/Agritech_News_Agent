export interface OllamaJsonChatParams {
    baseUrl: string;
    model: string;
    systemText: string;
    userText: string;
    temperature: number;
    timeoutMs: number;
    numPredict?: number;
}

interface OllamaChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OllamaChatResponse {
    message?: { role?: string; content?: string };
    error?: string;
}

export async function postOllamaJsonChat(params: OllamaJsonChatParams): Promise<string> {
    const root = params.baseUrl.replace(/\/$/, '');
    const url = `${root}/api/chat`;
    const messages: OllamaChatMessage[] = [
        { role: 'system', content: params.systemText },
        { role: 'user', content: params.userText },
    ];

    const body: Record<string, unknown> = {
        model: params.model,
        messages,
        stream: false,
        format: 'json',
        options: {
            temperature: params.temperature,
            ...(params.numPredict !== undefined ? { num_predict: params.numPredict } : {}),
        },
    };

    const signal = AbortSignal.timeout(params.timeoutMs);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });

    const json = (await res.json()) as OllamaChatResponse;
    if (!res.ok) {
        throw new Error(`Ollama HTTP ${res.status}: ${json.error ?? res.statusText}`);
    }
    if (json.error) {
        throw new Error(`Ollama error: ${json.error}`);
    }
    const content = json.message?.content?.trim();
    if (!content) {
        throw new Error('Ollama response missing message.content');
    }
    return content;
}

export function stripMarkdownJsonFence(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith('```')) {
        return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    return trimmed;
}
