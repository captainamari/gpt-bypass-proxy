/**
 * Configuration management for GPT Bypass Proxy Server
 */

import dotenv from 'dotenv';

dotenv.config();

const config = {
  server: {
    port: parseInt(process.env.PORT) || 10800,
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development'
  },

  proxy: {
    timeout: parseInt(process.env.PROXY_TIMEOUT) || 30000,
    maxConnections: parseInt(process.env.MAX_CONNECTIONS) || 1000,
    keepAliveTimeout: parseInt(process.env.KEEP_ALIVE_TIMEOUT) || 5000,
    allowedDomains: (process.env.ALLOWED_DOMAINS || 
      'openai.com,*.openai.com,chatgpt.com,*.chatgpt.com,oaistatic.com,*.oaistatic.com,oaiusercontent.com,*.oaiusercontent.com,azureedge.net,*.azureedge.net,auth0.com,*.auth0.com,statsig.com,*.statsig.com,statsigapi.net,*.statsigapi.net,intercom.io,*.intercom.io,intercomcdn.com,*.intercomcdn.com,gravatar.com,*.gravatar.com,cdn.oaistatic.com,cdn.openai.com,fonts.googleapis.com,fonts.gstatic.com,claude.ai,*.claude.ai,anthropic.com,*.anthropic.com,coze.com,*.coze.com,google.com,*.google.com,gemini.google.com,*.gemini.google.com,aistudio.google.com,*.aistudio.google.com,accounts.google.com,*.accounts.google.com,googleapis.com,*.googleapis.com,gstatic.com,*.gstatic.com,googleusercontent.com,*.googleusercontent.com,x.ai,*.x.ai,meta.ai,*.meta.ai,grok.com,*.grok.com'
    ).split(',').map(d => d.trim())
  },

  security: {
    enableCors: process.env.ENABLE_CORS === 'true',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    maxSize: process.env.LOG_MAX_SIZE || '20m',
    maxFiles: process.env.LOG_MAX_FILES || '14d',
    logDir: process.env.LOG_DIR || './logs'
  },

  monitoring: {
    enableMetrics: process.env.ENABLE_METRICS === 'true',
    metricsPort: parseInt(process.env.METRICS_PORT) || 9090,
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000
  },

  cache: {
    ttl: parseInt(process.env.CACHE_TTL) || 300, // 5 minutes
    maxKeys: parseInt(process.env.CACHE_MAX_KEYS) || 10000
  },

  admin: {
    enableAdminAPI: process.env.ENABLE_ADMIN_API === 'true',
    adminToken: process.env.ADMIN_TOKEN || 'default-admin-token'
  },

  ssl: {
    enabled: process.env.SSL_ENABLED === 'true',
    certPath: process.env.SSL_CERT_PATH,
    keyPath: process.env.SSL_KEY_PATH
  },

  database: {
    enabled: process.env.DB_ENABLED === 'true',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'gpt_bypass',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || ''
  }
};

// Validation
function validateConfig() {
  const errors = [];

  // Required fields validation
  if (!config.proxy.allowedDomains.length) {
    errors.push('ALLOWED_DOMAINS must be specified');
  }

  if (config.admin.enableAdminAPI && config.admin.adminToken === 'default-admin-token') {
    errors.push('ADMIN_TOKEN must be changed from default value in production');
  }

  if (config.ssl.enabled && (!config.ssl.certPath || !config.ssl.keyPath)) {
    errors.push('SSL_CERT_PATH and SSL_KEY_PATH must be specified when SSL is enabled');
  }

  // Environment-specific validation
  if (config.server.nodeEnv === 'production') {
    if (config.logging.level === 'debug') {
      console.warn('Warning: Debug logging is enabled in production');
    }
    
    if (config.security.corsOrigin === '*') {
      console.warn('Warning: CORS is set to allow all origins in production');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\\n${errors.join('\\n')}`);
  }
}

// Validate configuration on load
validateConfig();

export { config };
