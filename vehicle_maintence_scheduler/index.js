'use strict';

/**
 * Vehicle Maintenance Scheduler
 * Solves a 0/1 Knapsack problem per depot:
 *   - Capacity  = MechanicHours available at each depot
 *   - Items     = Vehicles with Duration (weight) and Impact (value)
 *   - Objective = Maximise total Impact within MechanicHours budget
 *
 * Algorithm: Bottom-up Dynamic Programming
 * Time Complexity : O(n * W) per depot
 * Space Complexity: O(n * W) per depot
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const axios = require('axios');
const { Log, configure } = require('../logging_middleware/index');

const BASE_URL = 'http://20.207.122.201/evaluation-service';
const TOKEN = process.env.AUTH_TOKEN;

configure(TOKEN);

const API_HEADERS = { Authorization: `Bearer ${TOKEN}` };

/**
 * 0/1 Knapsack via DP.
 * @param {Array<{TaskID:string, Duration:number, Impact:number}>} vehicles
 * @param {number} capacity - available mechanic hours
 * @returns {{ totalImpact: number, selectedVehicles: Array }}
 */
function knapsack(vehicles, capacity) {
  const n = vehicles.length;
  // table[i][w] = max impact using first i vehicles with w hours available
  const table = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const { Duration, Impact } = vehicles[i - 1];
    for (let w = 0; w <= capacity; w++) {
      if (Duration <= w) {
        table[i][w] = Math.max(table[i - 1][w], table[i - 1][w - Duration] + Impact);
      } else {
        table[i][w] = table[i - 1][w];
      }
    }
  }

  // Backtrack to find selected vehicles
  const selectedVehicles = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (table[i][w] !== table[i - 1][w]) {
      selectedVehicles.push(vehicles[i - 1]);
      w -= vehicles[i - 1].Duration;
    }
  }

  return { totalImpact: table[n][capacity], selectedVehicles };
}

async function main() {
  await Log('backend', 'info', 'service', 'Scheduler started');

  // Fetch depots
  await Log('backend', 'info', 'service', 'Fetching depots from API');
  const depotsRes = await axios.get(`${BASE_URL}/depots`, { headers: API_HEADERS });
  const depots = depotsRes.data.depots;
  await Log('backend', 'info', 'service', `Depots fetched: ${depots.length}`);

  // Fetch vehicles
  await Log('backend', 'info', 'service', 'Fetching vehicles from API');
  const vehiclesRes = await axios.get(`${BASE_URL}/vehicles`, { headers: API_HEADERS });
  const vehicles = vehiclesRes.data.vehicles;
  await Log('backend', 'info', 'service', `Vehicles fetched: ${vehicles.length}`);

  const results = [];

  for (const depot of depots) {
    await Log('backend', 'info', 'service', `Depot ${depot.ID}: hours=${depot.MechanicHours}`);

    const { totalImpact, selectedVehicles } = knapsack(vehicles, depot.MechanicHours);
    const totalDuration = selectedVehicles.reduce((sum, v) => sum + v.Duration, 0);

    await Log(
      'backend', 'info', 'service',
      `Depot ${depot.ID}: impact=${totalImpact} tasks=${selectedVehicles.length}`
    );

    results.push({
      depotID: depot.ID,
      mechanicHoursAvailable: depot.MechanicHours,
      mechanicHoursUsed: totalDuration,
      totalImpactScore: totalImpact,
      selectedTaskCount: selectedVehicles.length,
      selectedTasks: selectedVehicles.map((v) => ({
        taskID: v.TaskID,
        duration: v.Duration,
        impact: v.Impact,
      })),
    });
  }

  await Log('backend', 'info', 'service', 'Scheduling completed successfully');

  // Print structured results for screenshot
  process.stdout.write('\n========== VEHICLE SCHEDULING RESULTS ==========\n\n');
  process.stdout.write(JSON.stringify(results, null, 2));
  process.stdout.write('\n\n=================================================\n');

  return results;
}

main().catch(async (err) => {
  const detail = err.response ? `Status: ${err.response.status} Body: ${JSON.stringify(err.response.data)}` : '';
  process.stderr.write(`FATAL: ${err.message} ${detail}\n`);
  process.exit(1);
});
