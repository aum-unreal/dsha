// Minimal streamable-HTTP MCP server for the tests. `node fake-mcp-http.mjs <port> [pidfile]`.
// Replies to initialize as an SSE stream, to everything else as JSON, and
// requires the session id it hands out.
import http from 'node:http';
import fs from 'node:fs';
const port = +process.argv[2], pidfile = process.argv[3];
const SID = 'sess-' + port;
const tools = [{ name: 'ping', description: 'Replies pong', inputSchema: { type: 'object', properties: { n: { type: 'integer' } } } }];
http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    if (req.method === 'DELETE') { res.writeHead(204); return res.end(); }
    const m = JSON.parse(b);
    if (m.method === 'initialize') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': SID });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake-http', version: '1' } } })}\n\n`);
      return res.end();
    }
    if (req.headers['mcp-session-id'] !== SID) { res.writeHead(404); return res.end('no session'); }
    if (m.id === undefined) { res.writeHead(202); return res.end(); }
    const json = r => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...r })); };
    if (m.method === 'tools/list') return json({ result: { tools } });
    if (m.method === 'tools/call' && m.params.name === 'ping') return json({ result: { content: [{ type: 'text', text: 'pong ' + (m.params.arguments?.n ?? '') }] } });
    json({ error: { code: -32601, message: 'unknown ' + m.method } });
  });
}).listen(port, '127.0.0.1', () => { if (pidfile) fs.writeFileSync(pidfile, String(process.pid)); });
setTimeout(() => process.exit(0), 60000).unref?.();
