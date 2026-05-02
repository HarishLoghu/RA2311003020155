'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

/**
 * Priority Inbox Service — Stage 6
 *
 * Fetches notifications from the Affordmed API and returns the top-N
 * highest-priority unread notifications.
 *
 * Priority rules:
 *   Placement = 3  (highest)
 *   Result    = 2
 *   Event     = 1  (lowest)
 *
 * Within the same priority, more recent notifications rank higher.
 *
 * Efficiency: A min-heap of size N is used so that as new notifications
 * arrive (streaming / polling scenario) we maintain the top-N in O(log N)
 * per insertion rather than re-sorting the entire list.
 */

const axios = require('axios');
const { Log } = require('../../../logging_middleware/index');

const NOTIFICATIONS_API = 'http://20.207.122.201/evaluation-service/notifications';

const TYPE_WEIGHT = { Placement: 3, Result: 2, Event: 1 };

/**
 * Compute a numeric priority score for sorting.
 * Higher score = higher priority in the inbox.
 * @param {{ Type: string, Timestamp: string }} notification
 * @returns {number}
 */
function priorityScore(notification) {
  const typeWeight = TYPE_WEIGHT[notification.Type] ?? 0;
  const recency = new Date(notification.Timestamp).getTime(); // ms since epoch
  // Combine: type is the primary key, recency is the tiebreaker.
  // Multiply typeWeight by a large constant so it always dominates.
  return typeWeight * 1e15 + recency;
}

/**
 * Min-heap implementation keyed on priorityScore.
 * Maintains the top-N highest-priority items seen so far.
 */
class MinHeap {
  constructor() {
    this._heap = [];
  }

  get size() {
    return this._heap.length;
  }

  peek() {
    return this._heap[0] ?? null;
  }

  push(item) {
    this._heap.push(item);
    this._bubbleUp(this._heap.length - 1);
  }

  pop() {
    const top = this._heap[0];
    const last = this._heap.pop();
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  _bubbleUp(idx) {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this._heap[parent].score <= this._heap[idx].score) break;
      [this._heap[parent], this._heap[idx]] = [this._heap[idx], this._heap[parent]];
      idx = parent;
    }
  }

  _sinkDown(idx) {
    const n = this._heap.length;
    while (true) {
      let smallest = idx;
      const l = 2 * idx + 1;
      const r = 2 * idx + 2;
      if (l < n && this._heap[l].score < this._heap[smallest].score) smallest = l;
      if (r < n && this._heap[r].score < this._heap[smallest].score) smallest = r;
      if (smallest === idx) break;
      [this._heap[smallest], this._heap[idx]] = [this._heap[idx], this._heap[smallest]];
      idx = smallest;
    }
  }
}

/**
 * Fetch and return the top-N priority notifications.
 * @param {string} token  - Bearer auth token
 * @param {number} topN   - number of notifications to return (default 10)
 * @returns {Promise<Array>}
 */
async function getTopNNotifications(token, topN = 10) {
  await Log('backend', 'info', 'service', `Priority inbox: fetching top ${topN}`);

  const res = await axios.get(NOTIFICATIONS_API, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const notifications = res.data.notifications ?? [];
  await Log('backend', 'info', 'service', `Notifications received: ${notifications.length}`);

  // Use a min-heap of size topN to find the top-N in O(n log N)
  const heap = new MinHeap();

  for (const notif of notifications) {
    const score = priorityScore(notif);
    const entry = { score, data: notif };

    if (heap.size < topN) {
      heap.push(entry);
    } else if (score > heap.peek().score) {
      heap.pop();
      heap.push(entry);
    }
  }

  // Extract and sort descending (highest priority first)
  const result = [];
  while (heap.size > 0) result.push(heap.pop().data);
  result.sort((a, b) => priorityScore(b) - priorityScore(a));

  await Log('backend', 'info', 'service', `Returning top ${result.length} notifications`);

  return result;
}

module.exports = { getTopNNotifications };
