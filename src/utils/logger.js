/**
 * Winston-based logging utility
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config/index.js';
import fs from 'fs';
import path from 'path';

// Ensure log directory exists
if (!fs.existsSync(config.logging.logDir)) {
  fs.mkdirSync(config.logging.logDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = ` ${JSON.stringify(meta)}`;
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create transports
const transports = [
  // Console transport
  new winston.transports.Console({
    level: config.logging.level,
    format: consoleFormat,
    handleExceptions: true,
    handleRejections: true
  }),

  // File transport for all logs
  new DailyRotateFile({
    filename: path.join(config.logging.logDir, 'application-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: config.logging.maxSize,
    maxFiles: config.logging.maxFiles,
    level: config.logging.level,
    format: fileFormat,
    handleExceptions: true,
    handleRejections: true
  }),

  // Separate file for errors
  new DailyRotateFile({
    filename: path.join(config.logging.logDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: config.logging.maxSize,
    maxFiles: config.logging.maxFiles,
    level: 'error',
    format: fileFormat,
    handleExceptions: true,
    handleRejections: true
  })
];

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  transports,
  exitOnError: false
});

// Add request logging helper
logger.logRequest = (req, res, duration) => {
  const logData = {
    method: req.method,
    url: req.originalUrl || req.url,
    statusCode: res.statusCode,
    duration: `${duration}ms`,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    timestamp: new Date().toISOString()
  };

  if (res.statusCode >= 400) {
    logger.warn('HTTP Request', logData);
  } else {
    logger.info('HTTP Request', logData);
  }
};

// Add proxy logging helper
logger.logProxy = (method, url, target, statusCode, duration, error = null) => {
  const logData = {
    method,
    url,
    target,
    statusCode,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString()
  };

  if (error) {
    logger.error('Proxy Error', { ...logData, error: error.message, stack: error.stack });
  } else if (statusCode >= 400) {
    logger.warn('Proxy Request', logData);
  } else {
    logger.info('Proxy Request', logData);
  }
};

// Add metrics logging helper
logger.logMetrics = (metrics) => {
  logger.info('Metrics Report', {
    ...metrics,
    timestamp: new Date().toISOString()
  });
};

export { logger };