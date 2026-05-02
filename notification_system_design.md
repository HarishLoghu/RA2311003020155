# Stage 1

## REST API Design — Campus Notification Platform

This document defines the REST API contract for the Campus Notification Platform, which delivers real-time updates about Placements, Events, and Results to students.

---

### Base URL

```
http://localhost:3000/api/v1
```

---

### Authentication

All endpoints require a pre-authorised Bearer token passed in the request header:

```
Authorization: Bearer <token>
Content-Type: application/json
```

---

### Core Actions

| Action | Method | Endpoint |
|---|---|---|
| Get all notifications for a student | GET | `/notifications` |
| Get priority inbox (top-N) | GET | `/notifications/priority-inbox` |
| Get a single notification | GET | `/notifications/:id` |
| Mark a notification as read | PUT | `/notifications/:id/read` |
| Mark all notifications as read | PUT | `/notifications/read-all` |
| Create a notification (admin) | POST | `/notifications` |
| Delete a notification | DELETE | `/notifications/:id` |

---

### Endpoint Definitions

#### GET `/notifications`

Fetch all notifications for the authenticated student.

**Request Headers:**
```json
{
  "Authorization": "Bearer <token>"
}
```

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `type` | string | No | Filter by type: `Placement`, `Event`, `Result` |
| `isRead` | boolean | No | Filter by read status |
| `page` | number | No | Page number (default: 1) |
| `limit` | number | No | Items per page (default: 20) |

**Response (200):**
```json
{
  "success": true,
  "count": 25,
  "page": 1,
  "notifications": [
    {
      "id": "d146095a-0d86-4a34-9e69-3900a14576bc",
      "type": "Result",
      "message": "mid-sem results published",
      "isRead": false,
      "createdAt": "2026-04-22T17:51:30Z"
    }
  ]
}
```

---

#### GET `/notifications/priority-inbox`

Returns the top-N highest-priority unread notifications.
Priority: **Placement > Result > Event**, with recency as tiebreaker.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `top` | number | No | Number of notifications to return (default: 10) |

**Response (200):**
```json
{
  "success": true,
  "count": 10,
  "topN": 10,
  "notifications": [
    {
      "id": "b283218f-ea5a-4b7c-93a9-1f2f240d64b0",
      "type": "Placement",
      "message": "CSX Corporation hiring",
      "isRead": false,
      "createdAt": "2026-04-22T17:51:18Z"
    }
  ]
}
```

---

#### PUT `/notifications/:id/read`

Mark a single notification as read.

**Response (200):**
```json
{
  "success": true,
  "message": "Notification marked as read",
  "notificationId": "d146095a-0d86-4a34-9e69-3900a14576bc"
}
```

---

#### POST `/notifications` (Admin)

Create a new notification broadcast.

**Request Body:**
```json
{
  "type": "Placement",
  "message": "Google hiring — apply by 5th May",
  "targetStudentIds": ["all"]
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Notification queued for delivery",
  "notificationId": "abc123"
}
```

---

### Real-Time Notification Mechanism

**Server-Sent Events (SSE)**

SSE is chosen over WebSockets because notifications are **server-to-client only** (unidirectional), making SSE the simpler and more appropriate fit.

**Endpoint:** `GET /notifications/stream`

```
Accept: text/event-stream
Authorization: Bearer <token>
```

**Event format:**
```
event: notification
data: {"id":"abc","type":"Placement","message":"Google hiring","createdAt":"..."}
```

Students connect once; the server pushes events as new notifications arrive. Reconnection is handled automatically by the browser's EventSource API.

---

# Stage 2

## Database Design

### Database Choice: PostgreSQL

**Reasoning:**
- Notifications have a clear relational structure (students ↔ notifications ↔ read-status)
- PostgreSQL's **partial indexes** and **composite indexes** make it ideal for `WHERE isRead = false` queries
- Full ACID compliance ensures read-status updates are reliable
- JSONB support allows flexible metadata storage if needed in future

---

### Schema

```sql
CREATE TYPE notification_type AS ENUM ('Placement', 'Event', 'Result');

CREATE TABLE students (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(255) UNIQUE NOT NULL,
  name        VARCHAR(255) NOT NULL,
  roll_no     VARCHAR(50)  UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type notification_type NOT NULL,
  message           TEXT         NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE student_notifications (
  id               SERIAL  PRIMARY KEY,
  student_id       INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  notification_id  UUID    NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  is_read          BOOLEAN NOT NULL DEFAULT FALSE,
  read_at          TIMESTAMPTZ,
  UNIQUE (student_id, notification_id)
);

-- Indexes
CREATE INDEX idx_sn_student_unread
  ON student_notifications (student_id, is_read, notification_id);

CREATE INDEX idx_notif_type_created
  ON notifications (notification_type, created_at DESC);
```

---

### Scalability Problems & Solutions

| Problem | Solution |
|---|---|
| Table grows to billions of rows | Partition `notifications` by `created_at` (monthly) |
| Slow `ORDER BY created_at` | Composite index on `(student_id, is_read, created_at DESC)` |
| Fan-out on broadcast (50k inserts) | Write to a queue (e.g., Bull + Redis); background workers insert |
| Read-heavy traffic | Redis cache per student; invalidate on new notification |

---

### SQL Queries

**Fetch unread notifications for a student:**
```sql
SELECT n.id, n.notification_type, n.message, n.created_at
FROM student_notifications sn
JOIN notifications n ON n.id = sn.notification_id
WHERE sn.student_id = $1
  AND sn.is_read = FALSE
ORDER BY n.created_at DESC
LIMIT 20;
```

**Mark notification as read:**
```sql
UPDATE student_notifications
SET is_read = TRUE, read_at = NOW()
WHERE student_id = $1 AND notification_id = $2;
```

---

# Stage 3

## Query Analysis & Optimisation

### Original Query

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

### Is This Query Accurate?

**Partially.** It correctly filters by student and read-status, but:
- `SELECT *` fetches every column — wasteful when the UI only needs `id`, `type`, `message`, `createdAt`
- No `LIMIT` clause — returns all matching rows, which becomes dangerous at scale

### Why Is It Slow?

At 50,000 students × 5,000,000 notifications:
- Without an index on `(studentID, isRead)`, PostgreSQL performs a **full sequential scan** of 5M rows
- `ORDER BY createdAt DESC` then requires sorting the entire filtered result set in memory
- Estimated cost: O(N) scan + O(K log K) sort where N = 5M, K = matching rows

### Fix

```sql
-- Create a composite index (covering index)
CREATE INDEX idx_notifications_student_unread_date
  ON notifications (studentID, isRead, createdAt DESC)
  WHERE isRead = false;  -- partial index: only indexes unread rows

-- Optimised query
SELECT id, notificationType, message, createdAt
FROM notifications
WHERE studentID = 1042
  AND isRead = false
ORDER BY createdAt DESC
LIMIT 20;
```

**Cost after fix:** Index range scan → O(log N + K), where K = results returned. Dramatically faster.

### Is "Index Every Column" Good Advice?

**No.** Adding indexes on every column causes:
- Increased **write overhead** — every INSERT/UPDATE must update all indexes
- Higher **storage usage**
- Slower bulk operations (e.g., bulk notification inserts)

Only index columns used in `WHERE`, `ORDER BY`, or `JOIN` conditions.

### Placement Notifications in Last 7 Days

```sql
SELECT id, message, createdAt
FROM notifications
WHERE notificationType = 'Placement'
  AND createdAt >= NOW() - INTERVAL '7 days'
ORDER BY createdAt DESC;
```

---

# Stage 4

## Performance Strategy — Reducing DB Load on Page Load

### Problem

Every page load triggers a DB query for each student's notifications. At 50,000 concurrent students this saturates the database.

### Solutions & Tradeoffs

#### 1. Redis Cache (Recommended Primary Strategy)

Cache each student's notification list with a short TTL (e.g., 60 seconds).

```
Key:   notifications:{studentId}
Value: JSON array of notifications
TTL:   60 seconds
```

**On new notification:** Invalidate (delete) the cache key for affected students.

| Tradeoff | Detail |
|---|---|
| ✅ Drastically reduces DB reads | Cache hit rate typically >95% |
| ✅ Sub-millisecond response | Redis in-memory |
| ⚠️ Stale data | Up to TTL seconds behind (acceptable for notifications) |
| ⚠️ Cache invalidation complexity | Must invalidate on every new notification |

#### 2. Pagination

Never load all notifications at once. Return 20 at a time.

| Tradeoff | Detail |
|---|---|
| ✅ Smaller queries, faster response | |
| ✅ Less memory per request | |
| ⚠️ UX requires "load more" | |

#### 3. SSE / WebSocket Push (Avoid Pull)

Instead of polling on every page load, push new notifications to connected clients in real time.

| Tradeoff | Detail |
|---|---|
| ✅ Zero unnecessary DB queries | |
| ✅ Real-time updates | |
| ⚠️ Server must maintain open connections | Higher memory per connection |

#### 4. Read Replicas

Route read queries to PostgreSQL read replicas; writes go to primary.

| Tradeoff | Detail |
|---|---|
| ✅ Scales read throughput linearly | Add more replicas |
| ⚠️ Replication lag | Slight inconsistency |
| ⚠️ Operational complexity | |

**Recommended architecture:** Redis cache + SSE push + pagination. Cache handles read load; SSE eliminates polling; pagination keeps payloads small.

---

# Stage 5

## Bulk Notification Redesign

### Problems with the Original Implementation

```javascript
function notify_all(student_ids, message) {
  for (student_id of student_ids) {
    send_email(student_id, message)   // ❌ synchronous, blocks loop
    save_to_db(student_id, message)   // ❌ tightly coupled with email
    push_to_app(student_id, message)  // ❌ all-or-nothing — no retry
  }
}
```

1. **Sequential loop** — 50,000 iterations, each blocking on I/O. Extremely slow.
2. **No fault tolerance** — if `send_email` fails at student 200, no retry; remaining 49,800 are skipped.
3. **Tight coupling** — email failure blocks DB save and in-app push.
4. **No atomicity guarantee** — email may be sent but DB save may fail (or vice versa).

### Redesigned Approach

**Decouple via message queue (e.g., Bull + Redis).**

```javascript
// Step 1: Save notification to DB immediately (single bulk insert)
async function notify_all(student_ids, message) {
  // Bulk insert into notifications table (single query, not per-student)
  const notificationId = await bulkInsertNotification(student_ids, message);

  // Enqueue delivery jobs (non-blocking)
  const jobs = student_ids.map(id => ({ studentId: id, notificationId, message }));
  await emailQueue.addBulk(jobs);      // email worker picks these up
  await pushQueue.addBulk(jobs);       // push worker picks these up
}

// Step 2: Email worker (runs independently, with retries)
emailQueue.process(async (job) => {
  const { studentId, message } = job.data;
  await send_email(studentId, message);   // retried up to 3 times on failure
});

// Step 3: Push worker (runs independently)
pushQueue.process(async (job) => {
  const { studentId, notificationId } = job.data;
  await push_to_app(studentId, notificationId);
});
```

### Should DB Save and Email Send Happen Together?

**No — they should be decoupled.**

- DB save is the **source of truth** and must happen first, atomically.
- Email delivery is a **side effect** and can fail or be retried independently.
- Using a **transactional outbox pattern**: save both the notification and a pending delivery record in one DB transaction. A background worker reads the outbox and sends emails, marking them delivered on success.

This guarantees: if the email API is down, the notification is still persisted and will be delivered when the API recovers.

### Revised Pseudocode

```javascript
async function notify_all(student_ids, message) {
  // 1. Atomic DB write
  const notification = await db.transaction(async (trx) => {
    const notif = await trx.notifications.bulkCreate(student_ids, message);
    await trx.outbox.bulkCreate(student_ids.map(id => ({
      studentId: id, notificationId: notif.id, status: 'pending'
    })));
    return notif;
  });

  // 2. Enqueue delivery (fire-and-forget; workers handle retries)
  await deliveryQueue.addBulk(
    student_ids.map(id => ({ studentId: id, notificationId: notification.id }))
  );
}

// Delivery worker: email + push, marks outbox as delivered
deliveryQueue.process(CONCURRENCY=100, async (job) => {
  const { studentId, notificationId } = job.data;
  await Promise.allSettled([
    send_email(studentId, notificationId),
    push_to_app(studentId, notificationId),
  ]);
  await db.outbox.markDelivered(studentId, notificationId);
});
```

---

# Stage 6

## Priority Inbox — Implementation

### Approach

Notifications are ranked by a composite priority score:

```
score = typeWeight × 10^15 + unixTimestampMs
```

Where `typeWeight`: Placement = 3, Result = 2, Event = 1.

Multiplying by 10^15 ensures **type always dominates** over recency, while timestamp breaks ties within the same type.

### Efficiency for Streaming Notifications

A **min-heap of size N** is used instead of sorting all notifications:
- For each incoming notification: if its score > heap minimum, evict the minimum and insert the new one.
- Time per notification: **O(log N)** — efficient for continuous incoming data.
- Final result: drain heap and sort descending → **O(N log N)** only over the top-N set.

This scales well even when tens of thousands of notifications are streamed.

### Code Location

`notification_app_be/src/services/priorityInbox.js`

### API Endpoint

```
GET /api/v1/notifications/priority-inbox?top=10
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "count": 10,
  "topN": 10,
  "notifications": [
    { "ID": "...", "Type": "Placement", "Message": "...", "Timestamp": "..." }
  ]
}
```
