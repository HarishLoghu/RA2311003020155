'use strict';

/**
 * Registration & Authentication setup script.
 * Run this ONCE with your accessCode from the Affordmed email:
 *   node setup.js <YOUR_ACCESS_CODE>
 *
 * This will:
 *   1. Register you on the Affordmed test server
 *   2. Obtain a Bearer token
 *   3. Save both to .env
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://20.207.122.201/evaluation-service';

const USER = {
  email: 'hl1455@srmist.edu.in',
  name: 'HARISH L',
  mobileNo: '9043861969',
  githubUsername: 'HarishLoghu',
  rollNo: 'RA2311003020155',
};

async function register(accessCode) {
  const res = await axios.post(`${BASE_URL}/register`, { ...USER, accessCode });
  return res.data;
}

async function getToken(clientID, clientSecret, accessCode) {
  const res = await axios.post(`${BASE_URL}/auth`, {
    ...USER,
    accessCode,
    clientID,
    clientSecret,
  });
  return res.data;
}

async function main() {
  const accessCode = process.argv[2];
  if (!accessCode) {
    process.stdout.write('Usage: node setup.js <ACCESS_CODE>\n');
    process.stdout.write('Get your access code from the Affordmed email.\n');
    process.exit(1);
  }

  process.stdout.write('Registering with Affordmed test server...\n');
  const reg = await register(accessCode);
  process.stdout.write(`Registration successful!\n`);
  process.stdout.write(`clientID     : ${reg.clientID}\n`);
  process.stdout.write(`clientSecret : ${reg.clientSecret}\n`);
  process.stdout.write('IMPORTANT: Save these — you cannot retrieve them again!\n\n');

  process.stdout.write('Obtaining auth token...\n');
  const auth = await getToken(reg.clientID, reg.clientSecret, accessCode);

  const envContent = [
    `AUTH_TOKEN=${auth.access_token}`,
    `CLIENT_ID=${reg.clientID}`,
    `CLIENT_SECRET=${reg.clientSecret}`,
    `TOKEN_EXPIRES_IN=${auth.expires_in}`,
  ].join('\n') + '\n';

  const envPath = path.join(__dirname, '.env');
  fs.writeFileSync(envPath, envContent, 'utf8');

  process.stdout.write('Auth token obtained and saved to .env\n');
  process.stdout.write('Setup complete! You can now run the scheduler and notification services.\n');
}

main().catch((err) => {
  process.stdout.write(`Setup failed: ${JSON.stringify(err.response?.data) || err.message}\n`);
  process.exit(1);
});
