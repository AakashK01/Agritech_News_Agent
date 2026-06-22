import { join } from 'path';

export function resolveAgentBrowserJs(projectRoot: string, overridePath?: string): string {
    if (overridePath && overridePath.length > 0) {
        return overridePath;
    }
    return join(projectRoot, 'node_modules', 'agent-browser', 'bin', 'agent-browser.js');
}
