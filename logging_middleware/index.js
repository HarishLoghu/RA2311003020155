'use strict';

const axios = require('axios');

const LOG_API_URL = 'http://20.207.122.201/evaluation-service/logs';

const VALID_STACKS = ['backend', 'frontend'];
const VALID_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];
const VALID_PACKAGES = [
  // Backend only
  'cache', 'controller', 'cron_job', 'db', 'domain',
  'handler', 'repository', 'route', 'service',
  // Frontend only
  'api', 'component', 'hook', 'page', 'state', 'style',
  // Both
  'auth', 'config', 'middleware', 'utils',
];

let _token = null;

/**
 * Configure the logging middleware with a Bearer token.
 * Must be called before any Log() calls.
 * @param {string} token - Bearer access token
 */
function configure(token) {
  if (!token) throw new Error('configure() requires a valid Bearer token.');
  _token = token;
}

/**
 * Send a structured log entry to the Affordmed log server.
 * @param {string} stack   - 'backend' | 'frontend'
 * @param {string} level   - 'debug' | 'info' | 'warn' | 'error' | 'fatal'
 * @param {string} pkg     - package name (see VALID_PACKAGES)
 * @param {string} message - descriptive log message
 * @returns {Promise<{logID: string, message: string}>}
 */
async function Log(stack, level, pkg, message) {
  if (!_token) {
    throw new Error(
      'Logging middleware is not configured. Call configure(token) before using Log().'
    );
  }

  if (!VALID_STACKS.includes(stack)) {
    throw new Error(`Invalid stack: "${stack}". Allowed: ${VALID_STACKS.join(', ')}`);
  }
  if (!VALID_LEVELS.includes(level)) {
    throw new Error(`Invalid level: "${level}". Allowed: ${VALID_LEVELS.join(', ')}`);
  }
  if (!VALID_PACKAGES.includes(pkg)) {
    throw new Error(`Invalid package: "${pkg}". Allowed: ${VALID_PACKAGES.join(', ')}`);
  }

  const response = await axios.post(
    LOG_API_URL,
    { stack, level, package: pkg, message },
    {
      headers: {
        Authorization: `Bearer ${_token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data; // { logID, message }
}

module.exports = { Log, configure };
