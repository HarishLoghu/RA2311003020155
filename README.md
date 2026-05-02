# Backend Evaluation — RA2311003020155

## Project Structure

```
├── logging_middleware/          # Reusable logging package
├── vehicle_maintence_scheduler/ # Vehicle scheduling microservice
├── notification_app_be/         # Campus notification backend
└── notification_system_design.md # System design document (Stages 1–6)
```

## Setup

### 1. Install dependencies

```bash
npm install
cd logging_middleware && npm install
cd ../vehicle_maintence_scheduler && npm install
cd ../notification_app_be && npm install
```

### 2. Configure environment

```bash
node setup.js <ACCESS_CODE>
```

This registers you on the evaluation server and saves your auth token to `.env`.

## Running

### Vehicle Maintenance Scheduler

```bash
node vehicle_maintence_scheduler/index.js
```

Fetches depots and vehicles from the evaluation API, then runs a 0/1 Knapsack
dynamic programming algorithm per depot to maximise total impact within available
mechanic hours.

### Notification Service

```bash
node notification_app_be/src/index.js
```

Starts the Express server on port 3000.

| Endpoint | Description |
|---|---|
| `GET /health` | Health check |
| `GET /api/v1/notifications` | All notifications |
| `GET /api/v1/notifications/priority-inbox?top=10` | Top-N priority notifications |

## Logging Middleware

All code uses the reusable `Log(stack, level, package, message)` function
which sends structured logs to the evaluation server. No `console.log` or
built-in loggers are used anywhere in the application code.

```js
const { Log, configure } = require('./logging_middleware/index');
configure(process.env.AUTH_TOKEN);
await Log('backend', 'info', 'service', 'Service started');
```
