/**
 * GPT Bypass Proxy Server (Forward Proxy)
 *
 * Built to work with the Chrome extension PAC script:
 * - HTTP proxying: absolute-form requests (e.g. `GET http://example.com/path`)
 * - HTTPS proxying: CONNECT tunneling (e.g. `CONNECT chatgpt.com:443`)
 */

import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';
import { URL } from 'url';
import dotenv from 'dotenv';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import { logger } from './utils/logger.js';
import { config } from './config/index.js';

dotenv.config();

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade'
]);

// Headers that might reveal client IP or proxy usage
const sensitiveHeaders = new Set([
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
  'via',
  'x-client-ip',
  'client-ip',
  'cf-connecting-ip',
  'fastly-client-ip',
  'true-client-ip',
  'x-cluster-client-ip',
  'x-forwarded',
  'forwarded-for',
  'x-forwarded-proto', // Sometimes reveals protocol, usually harmless but safer to strip
  'priority' // HTTP/2 priority header, sometimes causes issues with HTTP/1.1 upstreams
]);

function normalizeHost(host) {
  if (!host) return null;
  const withoutProtocol = host.toLowerCase().replace(/^https?:\/\//, '');
  const withoutPath = withoutProtocol.replace(/\/.*$/, '');
  const withoutPort = withoutPath.replace(/:\d+$/, '');
  return withoutPort.trim();
}

function createAllowedDomainMatcher() {
  const allowed = (config.proxy.allowedDomains || [])
    .map((domain) => domain.toLowerCase().trim())
    .filter(Boolean);

  const exact = new Set(allowed.filter((domain) => !domain.startsWith('*.')));
  const wildcards = allowed.filter((domain) => domain.startsWith('*.')).map((domain) => domain.slice(2));

  return (host) => {
    const normalized = normalizeHost(host);
    if (!normalized) return false;
    if (exact.has(normalized)) return true;
    for (const base of wildcards) {
      if (normalized === base || normalized.endsWith(`.${base}`)) return true;
    }
    return false;
  };
}

const isAllowedDomain = createAllowedDomainMatcher();

function getClientIp(req) {
  // Security: Prefer remoteAddress to avoid X-Forwarded-For spoofing unless behind a trusted proxy
  // For this standalone deployment, we trust the direct connection IP.
  // const forwarded = req.headers['x-forwarded-for'];
  // if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkProxyAuth(req) {
  if (!config.auth.password) return true;

  const authHeader = req.headers['proxy-authorization'];
  if (!authHeader) return false;

  const [type, credentials] = authHeader.split(' ');
  if (type !== 'Basic' || !credentials) return false;

  const [user, pass] = Buffer.from(credentials, 'base64').toString().split(':');
  // We don't enforce username, only password
  return pass === config.auth.password;
}

function stripConnectionListedHeaders(headers) {
  const connection = headers.connection;
  if (!connection) return;

  const values = Array.isArray(connection) ? connection.join(',') : String(connection);
  for (const name of values.split(',')) {
    const headerName = name.trim().toLowerCase();
    if (headerName) delete headers[headerName];
  }
}

function sanitizeRequestHeaders(originalHeaders, targetHostHeader) {
  const headers = { ...originalHeaders };
  stripConnectionListedHeaders(headers);

  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (hopByHopHeaders.has(lower) || sensitiveHeaders.has(lower)) {
      delete headers[name];
    }
  }

  headers.host = targetHostHeader;
  return headers;
}

const rateLimiter = new RateLimiterMemory({
  points: config.security.rateLimitMaxRequests,
  duration: Math.max(1, Math.floor(config.security.rateLimitWindowMs / 1000)),
  blockDuration: 60
});

async function enforceRateLimit(req) {
  const key = getClientIp(req);
  await rateLimiter.consume(key);
}

function writeSimpleResponse(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function writeConnectError(clientSocket, statusCode, message) {
  const body = message ? `${message}\n` : '';
  const response =
    `HTTP/1.1 ${statusCode} ${http.STATUS_CODES[statusCode] || 'Error'}\r\n` +
    'Proxy-Agent: GPT-Bypass-Proxy\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    'Connection: close\r\n' +
    '\r\n' +
    body;
  try {
    clientSocket.end(response);
  } catch {
    clientSocket.destroy();
  }
}

function parseConnectHostPort(authority) {
  if (!authority) return null;

  const ipv6Match = authority.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6Match) return { host: ipv6Match[1], port: Number(ipv6Match[2]) };

  const idx = authority.lastIndexOf(':');
  if (idx === -1) return { host: authority, port: 443 };

  const host = authority.slice(0, idx);
  const port = Number(authority.slice(idx + 1)) || 443;
  return { host, port };
}

function handleHttpProxyRequest(req, res) {
  let targetUrl;
  try {
    if (req.url?.startsWith('http://') || req.url?.startsWith('https://')) {
      targetUrl = new URL(req.url);
    } else if (req.headers.host) {
      targetUrl = new URL(`http://${req.headers.host}${req.url || '/'}`);
    } else {
      writeSimpleResponse(res, 400, 'Bad Request: missing target host');
      return;
    }
  } catch {
    writeSimpleResponse(res, 400, 'Bad Request: invalid URL');
    return;
  }

  const hostname = targetUrl.hostname;
  if (!isAllowedDomain(hostname)) {
    writeSimpleResponse(res, 403, `Forbidden: domain not allowed (${hostname})`);
    return;
  }

  const isTls = targetUrl.protocol === 'https:';
  const port = Number(targetUrl.port) || (isTls ? 443 : 80);
  const path = `${targetUrl.pathname}${targetUrl.search}`;
  const targetHostHeader = port === (isTls ? 443 : 80) ? hostname : `${hostname}:${port}`;
  const headers = sanitizeRequestHeaders(req.headers, targetHostHeader);

  const upstream = (isTls ? https : http).request(
    {
      protocol: targetUrl.protocol,
      hostname,
      port,
      method: req.method,
      path,
      headers,
      timeout: config.proxy.timeout
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
  upstream.on('error', (err) => {
    logger.warn('Upstream request error', { error: err.message, host: hostname });
    if (!res.headersSent) writeSimpleResponse(res, 502, 'Bad Gateway');
    else res.destroy();
  });

  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

async function requestHandler(req, res) {
  if (req.url === '/health') {
    const payload = JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      allowedDomains: config.proxy.allowedDomains?.length || 0,
      authEnabled: !!config.auth.password
    });
    writeSimpleResponse(res, 200, payload, 'application/json; charset=utf-8');
    return;
  }

  if (!checkProxyAuth(req)) {
    res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="GPT Bypass Proxy"' });
    res.end('Proxy Authentication Required');
    return;
  }

  try {
    await enforceRateLimit(req);
  } catch {
    writeSimpleResponse(res, 429, 'Too Many Requests');
    return;
  }

  logger.info('HTTP proxy request', { method: req.method, url: req.url, ip: getClientIp(req) });
  handleHttpProxyRequest(req, res);
}

async function connectHandler(req, clientSocket, head) {
  if (!checkProxyAuth(req)) {
    writeConnectError(clientSocket, 407, 'Proxy Authentication Required');
    return;
  }

  try {
    await enforceRateLimit(req);
  } catch {
    writeConnectError(clientSocket, 429, 'Too Many Requests');
    return;
  }

  const parsed = parseConnectHostPort(req.url);
  if (!parsed?.host || !Number.isFinite(parsed.port)) {
    writeConnectError(clientSocket, 400, 'Bad Request: invalid CONNECT authority');
    return;
  }

  const hostname = normalizeHost(parsed.host);
  if (!isAllowedDomain(hostname)) {
    writeConnectError(clientSocket, 403, `Forbidden: domain not allowed (${hostname})`);
    return;
  }

  const upstreamSocket = net.connect(parsed.port, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: GPT-Bypass-Proxy\r\n\r\n');
    if (head?.length) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  const timeoutMs = config.proxy.timeout;
  upstreamSocket.setTimeout(timeoutMs);
  clientSocket.setTimeout(timeoutMs);

  upstreamSocket.on('timeout', () => upstreamSocket.destroy(new Error('Upstream CONNECT timeout')));
  clientSocket.on('timeout', () => clientSocket.destroy(new Error('Client CONNECT timeout')));

  upstreamSocket.on('error', (err) => {
    logger.warn('CONNECT upstream error', { error: err.message, host: hostname });
    writeConnectError(clientSocket, 502, 'Bad Gateway');
  });
  clientSocket.on('error', () => upstreamSocket.destroy());

  logger.info('CONNECT tunnel', { host: hostname, port: parsed.port, ip: getClientIp(req) });
}

function start() {
  if (typeof dns.setDefaultResultOrder === 'function') {
    const order = process.env.DNS_RESULT_ORDER;
    if (order === 'ipv4first' || order === 'verbatim') dns.setDefaultResultOrder(order);
  }

  const server = http.createServer((req, res) => {
    requestHandler(req, res).catch((err) => {
      logger.error('Request handler error', err);
      if (!res.headersSent) writeSimpleResponse(res, 500, 'Internal Server Error');
      else res.destroy();
    });
  });

  server.on('connect', (req, clientSocket, head) => {
    connectHandler(req, clientSocket, head).catch((err) => {
      logger.error('CONNECT handler error', err);
      writeConnectError(clientSocket, 500, 'Internal Server Error');
    });
  });

  server.keepAliveTimeout = config.proxy.keepAliveTimeout;
  server.headersTimeout = config.proxy.keepAliveTimeout + 1000;

  server.listen(config.server.port, config.server.host, () => {
    logger.info('GPT Bypass forward proxy started', {
      listen: `${config.server.host}:${config.server.port}`,
      allowedDomains: config.proxy.allowedDomains
    });
  });

  const graceful = (signal) => {
    logger.info(`Received ${signal}. Shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGTERM', () => graceful('SIGTERM'));
  process.on('SIGINT', () => graceful('SIGINT'));
}

start();
