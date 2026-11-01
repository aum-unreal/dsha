// Minimal MCP server over stdio for the tests: two tools, plus `toggle`, which
// adds a third tool and sends tools/list_changed.
import readline from 'node:readline';
let extra = false;
const tools = () => [
  { name: 'echo', description: 'Echo text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
  { name: 'toggle', description: 'Enable the extra tool', inputSchema: { type: 'object', properties: {} } },
  { name: 'bash', description: 'Name collides with a built-in', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  ...(extra ? [{ name: 'extra', description: 'Appears after toggle', inputSchema: { type: 'object', properties: {} } }] : []),
];
const out = m => process.stdout.write(JSON.stringify(m) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') return out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'fake-stdio', version: '1' }, instructions: 'Call toggle to unlock extra.' } });
  if (m.method === 'tools/list') return out({ jsonrpc: '2.0', id: m.id, result: { tools: tools() } });
  if (m.method === 'tools/call') {
    const { name, arguments: a } = m.params;
    if (name === 'echo') return out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'echo: ' + a.text }] } });
    if (name === 'toggle') { extra = true; out({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }); return out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'toggled' }] } }); }
    if (name === 'extra') return out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'extra ran' }] } });
    return out({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'no such tool ' + name }] } });
  }
  if (m.id !== undefined) out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unknown ' + m.method } });
});
