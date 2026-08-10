import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.argv[2] || 8080);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.urdf': 'application/xml; charset=utf-8',
  '.stl': 'application/sla',
  '.stp': 'model/step',
};

const json = (response, status, payload) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
};

const readBody = (request, limit = 48_000) => new Promise((resolve, reject) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
    if (body.length > limit) reject(new Error('Code is too large.'));
  });
  request.on('end', () => resolve(body));
  request.on('error', reject);
});

const runPythonSimulator = (payload) => new Promise((resolve) => {
  const runner = spawn('python', [path.join(root, 'python_sim_runner.py')], {
    cwd: root,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let error = '';
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    runner.kill();
  }, 2_500);
  runner.stdout.setEncoding('utf8');
  runner.stderr.setEncoding('utf8');
  runner.stdout.on('data', (chunk) => { output += chunk; });
  runner.stderr.on('data', (chunk) => { error += chunk; });
  runner.on('error', () => {
    clearTimeout(timeout);
    resolve({ ok: false, error: { message: 'The Python runner could not start on this machine.' } });
  });
  runner.on('close', () => {
    clearTimeout(timeout);
    if (timedOut) {
      resolve({ ok: false, error: { message: 'The program exceeded the 2.5 second limit and was stopped.' } });
      return;
    }
    try {
      resolve(JSON.parse(output));
    } catch {
      resolve({ ok: false, error: { message: 'The Python runner returned an invalid response.' }, detail: error.slice(0, 400) });
    }
  });
  runner.stdin.end(JSON.stringify(payload));
});

const server = http.createServer(async (request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (request.method === 'POST' && requestPath === '/api/python/run') {
    try {
      const payload = JSON.parse(await readBody(request));
      if (typeof payload.source !== 'string' || payload.source.length > 40_000) {
        json(response, 400, { ok: false, error: { message: 'Code must be a string of at most 40,000 characters.' } });
        return;
      }
      json(response, 200, await runPythonSimulator({ source: payload.source, positions: payload.positions || {} }));
    } catch (error) {
      json(response, 400, { ok: false, error: { message: error.message || 'Invalid Python request.' } });
    }
    return;
  }
  const relative = requestPath === '/' ? 'index.html'
    : ['/competition', '/competition/'].includes(requestPath) ? 'competition.html'
    : ['/competitive', '/competitive/'].includes(requestPath) ? 'competitive.html'
    : ['/project-guide', '/project-guide/'].includes(requestPath) ? 'project-guide.html'
    : requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, '127.0.0.1', () => console.log(`FR3 web simulator: http://127.0.0.1:${port}/`));
