import { Hono } from "hono";
import type { Env, User, Check, Channel } from "../types";
import { requireAuth } from "../middleware/session";
import { generateCheckId, generateId } from "../utils/id";
import {
  now,
  timeAgo,
  formatDuration,
  periodOptions,
  graceOptions,
  isInMaintSchedule,
  formatMaintSchedule,
} from "../utils/time";
import { parseCronExpression } from "../utils/cron-parser";
import {
  signWebhookPayload,
  generateSigningSecret,
} from "../utils/webhook-sign";

type DashboardEnv = { Bindings: Env; Variables: { user: User } };
const dashboard = new Hono<DashboardEnv>();

function parseTags(input: string | undefined | null): string {
  if (!input) return "";
  const tags = input
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  return [...new Set(tags)].join(",");
}

function renderTagPills(tags: string): string {
  if (!tags) return "";
  return tags
    .split(",")
    .map(
      (t) =>
        `<span class="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs">${escapeHtml(t)}</span>`,
    )
    .join(" ");
}

dashboard.use("*", requireAuth);

// Dashboard home - Check list
dashboard.get("/", async (c) => {
  const user = c.get("user");
  const tagFilter = (c.req.query("tag") || "").trim().toLowerCase();
  const timestamp = now();
  const day1 = timestamp - 86400;

  const day7 = timestamp - 7 * 86400;

  const [checks, uptimeRows, alertRows] = await Promise.all([
    c.env.DB.prepare(
      "SELECT * FROM checks WHERE user_id = ? ORDER BY created_at DESC",
    )
      .bind(user.id)
      .all<Check>(),
    c.env.DB.prepare(
      "SELECT check_id, COUNT(*) as total, SUM(CASE WHEN type = 'success' THEN 1 ELSE 0 END) as ok FROM pings WHERE check_id IN (SELECT id FROM checks WHERE user_id = ?) AND timestamp > ? GROUP BY check_id",
    )
      .bind(user.id, day7)
      .all<{ check_id: string; total: number; ok: number }>(),
    c.env.DB.prepare(
      "SELECT check_id, COUNT(*) as count FROM alerts WHERE check_id IN (SELECT id FROM checks WHERE user_id = ?) AND type = 'down' AND created_at > ? GROUP BY check_id",
    )
      .bind(user.id, day7)
      .all<{ check_id: string; count: number }>(),
  ]);

  const uptimeMap: Record<string, string> = {};
  const healthMap: Record<string, number> = {};
  const uptimeRawMap: Record<string, { total: number; ok: number }> = {};
  const alertCountMap: Record<string, number> = {};

  for (const row of uptimeRows.results) {
    uptimeRawMap[row.check_id] = { total: row.total, ok: row.ok };
    uptimeMap[row.check_id] =
      row.total > 0 ? ((row.ok / row.total) * 100).toFixed(1) + "%" : "—";
  }
  for (const row of alertRows.results) {
    alertCountMap[row.check_id] = row.count;
  }
  for (const check of checks.results) {
    const raw = uptimeRawMap[check.id] || { total: 0, ok: 0 };
    healthMap[check.id] = calcHealthScore(
      raw.total,
      raw.ok,
      alertCountMap[check.id] || 0,
      check.status,
    );
  }

  // Collect all unique tags and groups across checks
  const allTags = new Set<string>();
  const allGroups = new Set<string>();
  for (const check of checks.results) {
    if (check.tags) {
      for (const t of check.tags.split(",")) {
        if (t.trim()) allTags.add(t.trim());
      }
    }
    if (check.group_name) allGroups.add(check.group_name);
  }

  const groupFilter = (c.req.query("group") || "").trim();

  // Filter checks by tag and/or group
  let filteredChecks = checks.results;
  if (tagFilter) {
    filteredChecks = filteredChecks.filter(
      (check) =>
        check.tags &&
        check.tags
          .split(",")
          .map((t) => t.trim())
          .includes(tagFilter),
    );
  }
  if (groupFilter) {
    filteredChecks = filteredChecks.filter(
      (check) => check.group_name === groupFilter,
    );
  }

  // Import/export status messages
  const imported = c.req.query("imported");
  const error = c.req.query("error");
  let message = "";
  if (imported)
    message = `<div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">Successfully imported ${escapeHtml(imported)} checks.</div>`;
  if (error === "no-file")
    message = `<div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-800">No file selected.</div>`;
  if (error === "invalid-format")
    message = `<div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-800">Invalid file format. Expected CronPulse JSON export.</div>`;
  if (error === "parse-error")
    message = `<div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-800">Could not parse the file. Please check the format.</div>`;

  return c.html(
    renderLayout(
      user,
      "Checks",
      message +
        renderCheckList(
          filteredChecks,
          user,
          c.env.APP_URL,
          uptimeMap,
          [...allTags].sort(),
          tagFilter,
          healthMap,
          [...allGroups].sort(),
          groupFilter,
        ),
    ),
  );
});

// New check form
dashboard.get("/checks/new", async (c) => {
  const user = c.get("user");
  const checkCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM checks WHERE user_id = ?",
  )
    .bind(user.id)
    .first();

  if ((checkCount?.count as number) >= user.check_limit) {
    return c.html(
      renderLayout(
        user,
        "Limit Reached",
        `
      <div class="max-w-lg mx-auto bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
        <h2 class="text-lg font-semibold text-yellow-800">Check Limit Reached</h2>
        <p class="text-yellow-700 mt-2">You've used all ${user.check_limit} checks on your ${user.plan} plan.</p>
        <a href="/dashboard" class="text-blue-600 hover:underline mt-4 inline-block">Back to dashboard</a>
      </div>
    `,
      ),
    );
  }

  return c.html(renderLayout(user, "New Check", renderCheckForm()));
});

// Create check
dashboard.post("/checks", async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();

  const checkCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM checks WHERE user_id = ?",
  )
    .bind(user.id)
    .first();

  if ((checkCount?.count as number) >= user.check_limit) {
    return c.redirect("/dashboard");
  }

  const id = generateCheckId();
  const name = ((body.name as string) || "").trim() || "Unnamed Check";
  const cronExpr = ((body.cron_expression as string) || "").trim();
  let period = parseInt(body.period as string) || 3600;
  let grace = parseInt(body.grace as string) || 300;

  // If cron expression is provided, parse and use it to set period/grace
  if (cronExpr) {
    const parsed = parseCronExpression(cronExpr);
    if (
      parsed.valid &&
      parsed.periodSeconds >= 60 &&
      parsed.periodSeconds <= 604800
    ) {
      period = parsed.periodSeconds;
      grace = parsed.graceSeconds;
    }
  }

  const tags = parseTags(body.tags as string);
  const groupName = ((body.group_name as string) || "").trim();
  const maintStart = (body.maint_start as string)
    ? Math.floor(new Date(body.maint_start as string).getTime() / 1000)
    : null;
  const maintEnd = (body.maint_end as string)
    ? Math.floor(new Date(body.maint_end as string).getTime() / 1000)
    : null;
  const maintSchedule = ((body.maint_schedule as string) || "").trim();
  const timestamp = now();

  await c.env.DB.prepare(
    "INSERT INTO checks (id, user_id, name, period, grace, tags, group_name, cron_expression, maint_start, maint_end, maint_schedule, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      user.id,
      name,
      period,
      grace,
      tags,
      groupName,
      cronExpr,
      maintStart,
      maintEnd,
      maintSchedule,
      "new",
      timestamp,
      timestamp,
    )
    .run();

  // Link to default channels
  const defaultChannels = await c.env.DB.prepare(
    "SELECT id FROM channels WHERE user_id = ? AND is_default = 1",
  )
    .bind(user.id)
    .all();

  for (const ch of defaultChannels.results) {
    await c.env.DB.prepare(
      "INSERT INTO check_channels (check_id, channel_id) VALUES (?, ?)",
    )
      .bind(id, (ch as any).id)
      .run();
  }

  return c.redirect(`/dashboard/checks/${id}`);
});

// Check detail
dashboard.get("/checks/:id", async (c) => {
  const user = c.get("user");
  const checkId = c.req.param("id");

  const check = await c.env.DB.prepare(
    "SELECT * FROM checks WHERE id = ? AND user_id = ?",
  )
    .bind(checkId, user.id)
    .first<Check>();

  if (!check) return c.redirect("/dashboard");

  const timestamp = now();
  const day1 = timestamp - 86400;
  const day7 = timestamp - 7 * 86400;
  const day30 = timestamp - 30 * 86400;

  const [pings, alerts, uptime24h, uptime7d, uptime30d, alertCount7d] =
    await Promise.all([
      c.env.DB.prepare(
        "SELECT * FROM pings WHERE check_id = ? ORDER BY timestamp DESC LIMIT 50",
      )
        .bind(checkId)
        .all(),
      c.env.DB.prepare(
        "SELECT * FROM alerts WHERE check_id = ? ORDER BY created_at DESC LIMIT 20",
      )
        .bind(checkId)
        .all(),
      c.env.DB.prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN type = 'success' THEN 1 ELSE 0 END) as ok FROM pings WHERE check_id = ? AND timestamp > ?",
      )
        .bind(checkId, day1)
        .first<{ total: number; ok: number }>(),
      c.env.DB.prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN type = 'success' THEN 1 ELSE 0 END) as ok FROM pings WHERE check_id = ? AND timestamp > ?",
      )
        .bind(checkId, day7)
        .first<{ total: number; ok: number }>(),
      c.env.DB.prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN type = 'success' THEN 1 ELSE 0 END) as ok FROM pings WHERE check_id = ? AND timestamp > ?",
      )
        .bind(checkId, day30)
        .first<{ total: number; ok: number }>(),
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM alerts WHERE check_id = ? AND type = 'down' AND created_at > ?",
      )
        .bind(checkId, day7)
        .first<{ count: number }>(),
    ]);

  const uptimeStats = {
    day1: calcUptime(uptime24h?.total ?? 0, uptime24h?.ok ?? 0),
    day7: calcUptime(uptime7d?.total ?? 0, uptime7d?.ok ?? 0),
    day30: calcUptime(uptime30d?.total ?? 0, uptime30d?.ok ?? 0),
  };

  const healthScore = calcHealthScore(
    uptime7d?.total ?? 0,
    uptime7d?.ok ?? 0,
    alertCount7d?.count ?? 0,
    check.status,
  );

  return c.html(
    renderLayout(
      user,
      check.name,
      renderCheckDetail(
        check,
        pings.results,
        alerts.results,
        c.env.APP_URL,
        uptimeStats,
        healthScore,
      ),
    ),
  );
});

// Edit check form
dashboard.get("/checks/:id/edit", async (c) => {
  const user = c.get("user");
  const checkId = c.req.param("id");
  const check = await c.env.DB.prepare(
    "SELECT * FROM checks WHERE id = ? AND user_id = ?",
  )
    .bind(checkId, user.id)
    .first<Check>();

  if (!check) return c.redirect("/dashboard");

  return c.html(
    renderLayout(user, `Edit ${check.name}`, renderCheckForm(check)),
  );
});

// Update check
dashboard.post("/checks/:id", async (c) => {
  const user = c.get("user");
  const checkId = c.req.param("id");
  const body = await c.req.parseBody();

  const check = await c.env.DB.prepare(
    "SELECT * FROM checks WHERE id = ? AND user_id = ?",
  )
    .bind(checkId, user.id)
    .first();

  if (!check) return c.redirect("/dashboard");

  const name = ((body.name as string) || "").trim() || "Unnamed Check";
  const cronExpr = ((body.cron_expression as string) || "").trim();
  let period = parseInt(body.period as string) || 3600;
  let grace = parseInt(body.grace as string) || 300;

  // If cron expression is provided, parse and use it
  if (cronExpr) {
    const parsed = parseCronExpression(cronExpr);
    if (
      parsed.valid &&
      parsed.periodSeconds >= 60 &&
      parsed.periodSeconds <= 604800
    ) {
      period = parsed.periodSeconds;
      grace = parsed.graceSeconds;
    }
  }

  const tags = parseTags(body.tags as string);
  const groupName = ((body.group_name as string) || "").trim();
  const maintStart = (body.maint_start as string)
    ? Math.floor(new Date(body.maint_start as string).getTime() / 1000)
    : null;
  const maintEnd = (body.maint_end as string)
    ? Math.floor(new Date(body.maint_end as string).getTime() / 1000)
    : null;
  const maintSchedule = ((body.maint_schedule as string) || "").trim();

  await c.env.DB.prepare(
    "UPDATE checks SET name = ?, period = ?, grace = ?, tags = ?, group_name = ?, cron_expression = ?, maint_start = ?, maint_end = ?, maint_schedule = ?, updated_at = ? WHERE id = ?",
  )
    .bind(
      name,
      period,
      grace,
      tags,
      groupName,
      cronExpr,
      maintStart,
      maintEnd,
      maintSchedule,
      now(),
      checkId,
    )
    .run();

  // Invalidate KV cache
  try {
    await c.env.KV.delete(`check:${checkId}`);
  } catch {}

  return c.redirect(`/dashboard/checks/${checkId}`);
});

// Delete check
dashboard.post("/checks/:id/delete", async (c) => {
  const user = c.get("user");
  const checkId = c.req.param("id");

  await c.env.DB.prepare("DELETE FROM checks WHERE id = ? AND user_id = ?")
    .bind(checkId, user.id)
    .run();

  try {
    await c.env.KV.delete(`check:${checkId}`);
  } catch {}

  return c.redirect("/dashboard");
});

// Pause check
dashboard.post("/checks/:id/pause", async (c) => {
  const user = c.get("user");
  const checkId = c.req.param("id");

  await c.env.DB.prepare(
    "UPDATE checks SET status = 'paused', updated_at = ? WHERE id = ? AND user_id = ?",
  )
    .bind(now(), checkId, user.id)
    .run();

  try {
    await c.env.KV.delete(`check:${checkId}`);
  } catch {}

  return c.redirect(`/dashboard/checks/${checkId}`);
});

// Resume check
dashboard.post("/checks/:id/resume", async (c) => {
  const user = c.get("user");
  const checkId = c.req.param("id");

  await c.env.DB.prepare(
    "UPDATE checks SET status = 'new', updated_at = ? WHERE id = ? AND user_id = ?",
  )
    .bind(now(), checkId, user.id)
    .run();

  try {
    await c.env.KV.delete(`check:${checkId}`);
  } catch {}

  return c.redirect(`/dashboard/checks/${checkId}`);
});

// Export checks as JSON
dashboard.get("/export/json", async (c) => {
  const user = c.get("user");
  const checks = await c.env.DB.prepare(
    "SELECT id, name, period, grace, status, tags, group_name, cron_expression, created_at FROM checks WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(user.id)
    .all();

  const data = {
    version: 1,
    exported_at: new Date().toISOString(),
    checks: checks.results.map((ch: any) => ({
      name: ch.name,
      period: ch.period,
      grace: ch.grace,
      tags: ch.tags || "",
      group_name: ch.group_name || "",
      cron_expression: ch.cron_expression || "",
    })),
  };

  return c.json(data, 200, {
    "Content-Disposition": 'attachment; filename="cronpulse-checks.json"',
  });
});

// Export checks as CSV
dashboard.get("/export/csv", async (c) => {
  const user = c.get("user");
  const checks = await c.env.DB.prepare(
    "SELECT name, period, grace, status, tags, group_name, created_at FROM checks WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(user.id)
    .all();

  const header = "name,period_seconds,grace_seconds,status,tags,group";
  const rows = checks.results.map((ch: any) => {
    const name = '"' + (ch.name || "").replace(/"/g, '""') + '"';
    const tags = '"' + (ch.tags || "").replace(/"/g, '""') + '"';
    const group = '"' + (ch.group_name || "").replace(/"/g, '""') + '"';
    return `${name},${ch.period},${ch.grace},${ch.status},${tags},${group}`;
  });

  const csv = [header, ...rows].join("\n");
  return c.text(csv, 200, {
    "Content-Type": "text/csv",
    "Content-Disposition": 'attachment; filename="cronpulse-checks.csv"',
  });
});

// Import checks from JSON file
dashboard.post("/import", async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const file = body.file;

  if (!file || typeof file === "string") {
    return c.redirect("/dashboard?error=no-file");
  }

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.checks || !Array.isArray(data.checks)) {
      return c.redirect("/dashboard?error=invalid-format");
    }

    // Check limit
    const countResult = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM checks WHERE user_id = ?",
    )
      .bind(user.id)
      .first();
    const currentCount = (countResult?.count as number) || 0;
    const remaining = user.check_limit - currentCount;

    const toImport = data.checks.slice(0, remaining);
    let imported = 0;

    for (const ch of toImport) {
      if (!ch.name) continue;
      const id = generateCheckId();
      const name = String(ch.name).trim().slice(0, 200) || "Imported Check";
      const period = Math.max(
        60,
        Math.min(604800, parseInt(ch.period) || 3600),
      );
      const grace = Math.max(60, Math.min(3600, parseInt(ch.grace) || 300));
      const tags = parseTags(ch.tags || "");
      const groupName = (ch.group_name || "").trim().slice(0, 100);
      const timestamp = now();

      await c.env.DB.prepare(
        "INSERT INTO checks (id, user_id, name, period, grace, tags, group_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          id,
          user.id,
          name,
          period,
          grace,
          tags,
          groupName,
          "new",
          timestamp,
          timestamp,
        )
        .run();
      imported++;
    }

    return c.redirect(`/dashboard?imported=${imported}`);
  } catch {
    return c.redirect("/dashboard?error=parse-error");
  }
});

// Incident timeline
dashboard.get("/incidents", async (c) => {
  const user = c.get("user");
  const page = Math.max(1, parseInt(c.req.query("page") || "1") || 1);
  const checkFilter = (c.req.query("check") || "").trim();
  const typeFilter = (c.req.query("type") || "").trim().toLowerCase();
  const limit = 50;
  const offset = (page - 1) * limit;

  // Build WHERE clause dynamically
  let where = "c.user_id = ?";
  const params: any[] = [user.id];
  if (checkFilter) {
    where += " AND a.check_id = ?";
    params.push(checkFilter);
  }
  if (typeFilter === "down" || typeFilter === "recovery") {
    where += " AND a.type = ?";
    params.push(typeFilter);
  }

  const [alerts, totalResult, userChecks] = await Promise.all([
    c.env.DB.prepare(
      `
      SELECT a.*, c.name as check_name
      FROM alerts a
      INNER JOIN checks c ON a.check_id = c.id
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `,
    )
      .bind(...params, limit, offset)
      .all(),
    c.env.DB.prepare(
      `
      SELECT COUNT(*) as total FROM alerts a
      INNER JOIN checks c ON a.check_id = c.id
      WHERE ${where}
    `,
    )
      .bind(...params)
      .first<{ total: number }>(),
    c.env.DB.prepare(
      "SELECT id, name FROM checks WHERE user_id = ? ORDER BY name ASC",
    )
      .bind(user.id)
      .all<{ id: string; name: string }>(),
  ]);

  const total = totalResult?.total || 0;
  const totalPages = Math.ceil(total / limit);

  return c.html(
    renderLayout(
      user,
      "Incidents",
      renderIncidentTimeline(
        alerts.results,
        page,
        totalPages,
        total,
        userChecks.results,
        checkFilter,
        typeFilter,
      ),
    ),
  );
});

// Channels page
dashboard.get("/channels", async (c) => {
  const user = c.get("user");
  const channels = await c.env.DB.prepare(
    "SELECT * FROM channels WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(user.id)
    .all<Channel>();

  const testStatus = c.req.query("test");
  const testCh = c.req.query("ch") || "";
  const testErr = c.req.query("err") || "";

  let testMessage = "";
  if (testStatus === "ok") {
    testMessage = `<div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">Test notification sent to <strong>${escapeHtml(testCh)}</strong> successfully!</div>`;
  } else if (testStatus === "fail") {
    testMessage = `<div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-800">Failed to send test to <strong>${escapeHtml(testCh)}</strong>${testErr ? `: ${escapeHtml(testErr)}` : ""}.</div>`;
  }

  return c.html(
    renderLayout(
      user,
      "Notification Channels",
      testMessage + renderChannels(channels.results),
    ),
  );
});

// Create channel
dashboard.post("/channels", async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();

  const id = generateId();
  const kind = (body.kind as string) || "email";
  const target = ((body.target as string) || "").trim();
  const name = ((body.name as string) || "").trim() || kind;
  const isDefault = body.is_default ? 1 : 0;

  if (!target) return c.redirect("/dashboard/channels");

  // Validate target based on channel kind
  if (kind === "email") {
    if (!target.includes("@") || target.length > 320) {
      return c.redirect("/dashboard/channels");
    }
  } else if (kind === "webhook" || kind === "slack") {
    if (!target.startsWith("https://") || target.length > 2048) {
      return c.redirect("/dashboard/channels");
    }
  }

  await c.env.DB.prepare(
    "INSERT INTO channels (id, user_id, kind, target, name, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, user.id, kind, target, name, isDefault, now())
    .run();

  return c.redirect("/dashboard/channels");
});

// Test channel — send a test notification
dashboard.post("/channels/:id/test", async (c) => {
  const user = c.get("user");
  const channelId = c.req.param("id");

  const channel = await c.env.DB.prepare(
    "SELECT * FROM channels WHERE id = ? AND user_id = ?",
  )
    .bind(channelId, user.id)
    .first<Channel>();

  if (!channel) return c.redirect("/dashboard/channels");

  let success = false;
  let errorMsg = "";

  try {
    if (channel.kind === "email") {
      const { sendEmail, htmlEmail } = await import("../services/email");
      const result = await sendEmail(c.env, {
        to: channel.target,
        subject: "[CronPulse] Test Notification",
        text: "This is a test notification from CronPulse. If you received this, your email channel is working correctly!",
        html: htmlEmail({
          title: "Test Notification",
          heading: "Test Notification",
          body: '<p style="margin:0 0 12px"><strong style="color:#2563eb">Your email channel is working correctly!</strong></p><p style="margin:0;color:#374151;font-size:13px">This is a test notification from CronPulse. No action is required.</p>',
          ctaUrl: `${c.env.APP_URL}/dashboard/channels`,
          ctaText: "View Channels",
        }),
      });
      success = result.sent || result.demo;
      if (!success) errorMsg = result.error || "Unknown error";
    } else if (channel.kind === "webhook") {
      const body = JSON.stringify({
        event: "test",
        message: "This is a test notification from CronPulse.",
        timestamp: now(),
      });
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (user.webhook_signing_secret) {
        headers["X-CronPulse-Signature"] = await signWebhookPayload(
          body,
          user.webhook_signing_secret,
        );
      }
      const res = await fetch(channel.target, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(5000),
      });
      success = res.ok;
      if (!success) errorMsg = `HTTP ${res.status}`;
    } else if (channel.kind === "slack") {
      const res = await fetch(channel.target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "CronPulse Test Notification",
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: "CronPulse Test Notification",
                emoji: true,
              },
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: "*Status:*\nTest" },
                {
                  type: "mrkdwn",
                  text: "*Result:*\nYour Slack channel is working!",
                },
              ],
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: {
                    type: "plain_text",
                    text: "View Channels",
                    emoji: true,
                  },
                  url: `${c.env.APP_URL}/dashboard/channels`,
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(5000),
      });
      success = res.ok;
      if (!success) errorMsg = `HTTP ${res.status}`;
    }
  } catch (e) {
    success = false;
    errorMsg = String(e);
  }

  const status = success ? "ok" : "fail";
  return c.redirect(
    `/dashboard/channels?test=${status}&ch=${encodeURIComponent(channel.name || channel.kind)}${errorMsg ? `&err=${encodeURIComponent(errorMsg)}` : ""}`,
  );
});

// Delete channel
dashboard.post("/channels/:id/delete", async (c) => {
  const user = c.get("user");
  const channelId = c.req.param("id");

  await c.env.DB.prepare("DELETE FROM channels WHERE id = ? AND user_id = ?")
    .bind(channelId, user.id)
    .run();

  return c.redirect("/dashboard/channels");
});

// Billing page
dashboard.get("/billing", async (c) => {
  const user = c.get("user");
  return c.html(
    renderLayout(
      user,
      "Billing",
      renderBilling(user, c.env.LEMONSQUEEZY_STORE_URL),
    ),
  );
});

// Settings page
dashboard.get("/settings", async (c) => {
  const user = c.get("user");
  const saved = c.req.query("saved");
  const err = c.req.query("err");
  let msg = "";
  if (saved === "status-page")
    msg =
      '<div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">Status page settings saved.</div>';
  if (err === "logo-url")
    msg =
      '<div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-800">Logo URL must start with https://</div>';
  return c.html(renderLayout(user, "Settings", msg + renderSettings(user)));
});

// Generate API key
dashboard.post("/settings/api-key", async (c) => {
  const user = c.get("user");

  if (user.plan !== "pro" && user.plan !== "business") {
    return c.redirect("/dashboard/settings");
  }

  // Generate a new API key
  const { nanoid } = await import("nanoid");
  const apiKey = `cpk_${nanoid(40)}`;

  // Hash and store
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hashHex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await c.env.DB.prepare(
    "UPDATE users SET api_key_hash = ?, updated_at = ? WHERE id = ?",
  )
    .bind(hashHex, now(), user.id)
    .run();

  // Show the key once
  return c.html(
    renderLayout(
      user,
      "API Key Generated",
      `
    <div class="max-w-lg">
      <h1 class="text-2xl font-bold mb-6">API Key Generated</h1>
      <div class="bg-green-50 border border-green-200 rounded-lg p-6">
        <p class="text-sm text-green-800 font-medium mb-2">Copy your API key now. It won't be shown again.</p>
        <code class="block bg-white border rounded p-3 text-sm break-all">${apiKey}</code>
        <p class="text-xs text-green-600 mt-3">Use this key in the Authorization header: <code>Bearer ${apiKey}</code></p>
      </div>
      <a href="/dashboard/settings" class="text-blue-600 hover:underline text-sm mt-4 inline-block">Back to Settings</a>
    </div>
  `,
    ),
  );
});

// Update status page settings
dashboard.post("/settings/status-page", async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();

  const title = ((body.status_page_title as string) || "").trim().slice(0, 200);
  const logoUrl = ((body.status_page_logo_url as string) || "")
    .trim()
    .slice(0, 500);
  const description = ((body.status_page_description as string) || "")
    .trim()
    .slice(0, 500);
  const isPublic = body.status_page_public ? 1 : 0;

  // Basic URL validation for logo
  if (logoUrl && !logoUrl.startsWith("https://")) {
    return c.redirect("/dashboard/settings?err=logo-url");
  }

  await c.env.DB.prepare(
    "UPDATE users SET status_page_title = ?, status_page_logo_url = ?, status_page_description = ?, status_page_public = ?, updated_at = ? WHERE id = ?",
  )
    .bind(title, logoUrl, description, isPublic, now(), user.id)
    .run();

  return c.redirect("/dashboard/settings?saved=status-page");
});

// Generate/regenerate webhook signing secret
dashboard.post("/settings/webhook-secret", async (c) => {
  const user = c.get("user");
  const secret = generateSigningSecret();

  await c.env.DB.prepare(
    "UPDATE users SET webhook_signing_secret = ?, updated_at = ? WHERE id = ?",
  )
    .bind(secret, now(), user.id)
    .run();

  return c.html(
    renderLayout(
      user,
      "Webhook Signing Secret",
      `
    <div class="max-w-lg">
      <h1 class="text-2xl font-bold mb-6">Webhook Signing Secret</h1>
      <div class="bg-green-50 border border-green-200 rounded-lg p-6">
        <p class="text-sm text-green-800 font-medium mb-2">Your webhook signing secret has been generated. Copy it now.</p>
        <code class="block bg-white border rounded p-3 text-sm break-all">${secret}</code>
        <p class="text-xs text-green-600 mt-3">All outgoing webhook notifications will include an <code>X-CronPulse-Signature</code> header signed with this secret using HMAC-SHA256.</p>
      </div>
      <a href="/dashboard/settings" class="text-blue-600 hover:underline text-sm mt-4 inline-block">Back to Settings</a>
    </div>
  `,
    ),
  );
});

// --- Helpers ---

function calcUptime(total: number, ok: number): string {
  if (total === 0) return "—";
  return ((ok / total) * 100).toFixed(1) + "%";
}

function calcHealthScore(
  totalPings: number,
  okPings: number,
  alertCount: number,
  status: string,
): number {
  if (status === "paused") return -1; // Not applicable
  if (status === "new" || totalPings === 0) return -1; // No data yet
  // Uptime component: 0-70 points
  const uptimePct = totalPings > 0 ? okPings / totalPings : 1;
  const uptimeScore = Math.round(uptimePct * 70);
  // Alert frequency component: 0-30 points (0 alerts = 30, 5+ alerts = 0)
  const alertScore = Math.max(0, 30 - alertCount * 6);
  return Math.min(100, uptimeScore + alertScore);
}

function healthScoreBadge(score: number): string {
  if (score < 0)
    return '<span class="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">N/A</span>';
  let color = "bg-green-100 text-green-800";
  let label = "Excellent";
  if (score < 60) {
    color = "bg-red-100 text-red-800";
    label = "Poor";
  } else if (score < 80) {
    color = "bg-yellow-100 text-yellow-800";
    label = "Fair";
  } else if (score < 95) {
    color = "bg-blue-100 text-blue-800";
    label = "Good";
  }
  return `<span class="px-2 py-0.5 rounded text-xs font-medium ${color}" title="Health score: ${score}/100">${score} ${label}</span>`;
}

function uptimeColor(pct: string): string {
  if (pct === "—") return "text-gray-400";
  const n = parseFloat(pct);
  if (n >= 99.5) return "text-green-600";
  if (n >= 95) return "text-yellow-600";
  return "text-red-600";
}

function renderSparkline(pings: any[]): string {
  // Take last 30 pings, oldest first
  const recent = pings.slice(0, 30).reverse();
  if (recent.length === 0)
    return '<p class="text-sm text-gray-400">No data yet</p>';

  const barW = 8;
  const gap = 2;
  const h = 32;
  const totalW = recent.length * (barW + gap) - gap;

  const bars = recent
    .map((p: any, i: number) => {
      const x = i * (barW + gap);
      const color =
        p.type === "success"
          ? "#22c55e"
          : p.type === "start"
            ? "#3b82f6"
            : "#ef4444";
      return `<rect x="${x}" y="0" width="${barW}" height="${h}" rx="2" fill="${color}" opacity="0.85"><title>${new Date(p.timestamp * 1000).toISOString().replace("T", " ").slice(0, 19)} — ${p.type}</title></rect>`;
    })
    .join("");

  return `<svg width="${totalW}" height="${h}" viewBox="0 0 ${totalW} ${h}" class="inline-block">${bars}</svg>`;
}

// --- View Renderers ---

function renderLayout(user: User, title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="transition-colors duration-300">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - CronPulse</title>
  
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
  tailwind.config = {
    darkMode: 'class'
  }
  </script>

  <script>
    document.addEventListener('DOMContentLoaded', function () {
      const html = document.documentElement;
      const btn = document.getElementById('theme-toggle');
      const icon = document.getElementById('theme-icon');

      function setIcon() {
        if (!icon) return;

        if (html.classList.contains('dark')) {
          icon.innerHTML =
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m8-9h1M3 12H2m15.364 6.364l.707.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M12 7a5 5 0 100 10 5 5 0 000-10z" />';
        } else {
          icon.innerHTML =
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12.79A9 9 0 1111.21 3c0 .34.02.67.05 1A7 7 0 0021 12.79z" />';
        }
      }

      function applyTheme(theme) {
        if (theme === 'dark') {
          html.classList.add('dark');
        } else {
          html.classList.remove('dark');
        }
        setIcon();
      }

      const saved = localStorage.getItem('theme');
      if (saved) {
        applyTheme(saved);
      } else {
        applyTheme('light');
      }

      if (btn) {
        btn.addEventListener('click', function () {
          const isDark = html.classList.contains('dark');
          const newTheme = isDark ? 'light' : 'dark';
          localStorage.setItem('theme', newTheme);
          applyTheme(newTheme);
        });
      }
    });
  </script>

</head>
<body class="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen transition-colors duration-300">
  <nav class="bg-white dark:bg-gray-800 border-b dark:border-gray-700 transition-colors duration-300">
    <div class="max-w-5xl mx-auto px-4 py-3">
      <div class="flex items-center justify-between">
        <a href="/dashboard" class="text-lg font-bold text-gray-900 dark:text-white">CronPulse</a>
        <div class="flex items-center gap-2 sm:gap-4">
        <button id="theme-toggle"
          class="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition"
          aria-label="Toggle theme">
          <svg id="theme-icon" class="w-5 h-5 text-gray-600 dark:text-gray-300"
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M21 12.79A9 9 0 1111.21 3c0 .34.02.67.05 1A7 7 0 0021 12.79z"/>
          </svg>
        </button>

          <span class="text-xs text-gray-400 hidden sm:inline">${escapeHtml(user.email)}</span>
          <span class="text-xs text-gray-400 capitalize">${user.plan}</span>
          <form method="POST" action="/auth/logout" style="display:inline">
            <button type="submit" class="text-sm text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-white">Logout</button>
          </form>
          

        </div>
      </div>
      <div class="flex items-center gap-4 mt-2 overflow-x-auto text-sm">
        <a href="/dashboard" class="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white whitespace-nowrap">Checks</a>
        <a href="/dashboard/incidents" class="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white whitespace-nowrap">Incidents</a>
        <a href="/dashboard/channels" class="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white whitespace-nowrap">Channels</a>
        <a href="/dashboard/billing" class="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white whitespace-nowrap">Billing</a>
        <a href="/dashboard/settings" class="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white whitespace-nowrap">Settings</a>
      </div>
    </div>  
  </nav>
  <main class="max-w-5xl mx-auto px-4 py-6 sm:py-8">
    ${content}
  </main>
</body>
</html>`;
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    up: "bg-green-100 text-green-800",
    down: "bg-red-100 text-red-800",
    new: "bg-gray-100 text-gray-800",
    paused: "bg-yellow-100 text-yellow-800",
  };
  return `<span class="px-2 py-0.5 rounded text-xs font-medium ${colors[status] || colors.new}">${status}</span>`;
}

function maintBadge(check: Check): string {
  const ts = now();
  // Check recurring schedule first
  if (check.maint_schedule && isInMaintSchedule(check.maint_schedule, ts)) {
    return '<span class="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800" title="In recurring maintenance">maint</span>';
  }
  if (check.maint_schedule) {
    return '<span class="px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-600" title="Recurring maintenance configured">sched</span>';
  }
  if (!check.maint_start || !check.maint_end) return "";
  if (ts >= check.maint_start && ts <= check.maint_end) {
    return '<span class="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800" title="In maintenance window">maint</span>';
  }
  if (ts < check.maint_start) {
    return '<span class="px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-600" title="Maintenance scheduled">sched</span>';
  }
  return "";
}

function renderCheckList(
  checks: Check[],
  user: User,
  appUrl: string,
  uptimeMap?: Record<string, string>,
  allTags?: string[],
  activeTag?: string,
  healthMap?: Record<string, number>,
  allGroups?: string[],
  activeGroup?: string,
): string {
  // Build filter query strings preserving other filters
  function filterUrl(params: Record<string, string>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v) parts.push(`${k}=${encodeURIComponent(v)}`);
    }
    return "/dashboard" + (parts.length ? "?" + parts.join("&") : "");
  }

  const groupFilterBar =
    allGroups && allGroups.length > 0
      ? `
    <div class="flex flex-wrap items-center gap-2 mb-2">
      <span class="text-xs text-gray-500 font-medium">Group:</span>
      <a href="${filterUrl({ tag: activeTag || "" })}" class="px-2 py-0.5 rounded-full text-xs ${!activeGroup ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}">All</a>
      ${allGroups
        .map(
          (g) => `
        <a href="${filterUrl({ group: activeGroup === g ? "" : g, tag: activeTag || "" })}" class="px-2 py-0.5 rounded-full text-xs ${activeGroup === g ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"}">
          ${escapeHtml(g)}${activeGroup === g ? ' <span class="ml-0.5">&times;</span>' : ""}
        </a>
      `,
        )
        .join("")}
    </div>
  `
      : "";

  const tagFilterBar =
    allTags && allTags.length > 0
      ? `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <span class="text-xs text-gray-500 font-medium">Tag:</span>
      <a href="${filterUrl({ group: activeGroup || "" })}" class="px-2 py-0.5 rounded-full text-xs ${!activeTag ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}">All</a>
      ${allTags
        .map(
          (tag) => `
        <a href="${filterUrl({ tag: activeTag === tag ? "" : tag, group: activeGroup || "" })}" class="px-2 py-0.5 rounded-full text-xs ${activeTag === tag ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"}">
          ${escapeHtml(tag)}${activeTag === tag ? ' <span class="ml-0.5">&times;</span>' : ""}
        </a>
      `,
        )
        .join("")}
    </div>
  `
      : "";

  return `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Your Checks</h1>
      <div class="flex items-center gap-2">
        <div class="relative" id="export-menu">
          <button onclick="document.getElementById('export-dropdown').classList.toggle('hidden')"
            class="px-3 py-2 border rounded-md text-sm text-gray-600 hover:bg-gray-50">Export</button>
          <div id="export-dropdown" class="hidden absolute right-0 mt-1 bg-white border rounded-lg shadow-lg py-1 z-10">
            <a href="/dashboard/export/json" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Export JSON</a>
            <a href="/dashboard/export/csv" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Export CSV</a>
          </div>
        </div>
        <button onclick="document.getElementById('import-file').click()"
          class="px-3 py-2 border rounded-md text-sm text-gray-600 hover:bg-gray-50">Import</button>
        <form id="import-form" method="POST" action="/dashboard/import" enctype="multipart/form-data" class="hidden">
          <input type="file" id="import-file" name="file" accept=".json" onchange="document.getElementById('import-form').submit()">
        </form>
        <a href="/dashboard/checks/new" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">+ New Check</a>
      </div>
    </div>
    <p class="text-sm text-gray-500 mb-4">${checks.length} / ${user.check_limit} checks used</p>
    ${groupFilterBar}
    ${tagFilterBar}
    ${
      checks.length === 0
        ? `
      <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-12 text-center">
        <p class="text-gray-500">${activeTag || activeGroup ? "No checks match the current filter." : "No checks yet. Create your first one!"}</p>
        ${activeTag || activeGroup ? '<a href="/dashboard" class="text-blue-600 hover:underline text-sm mt-2 inline-block">Clear filter</a>' : '<a href="/dashboard/checks/new" class="text-blue-600 hover:underline text-sm mt-2 inline-block">Create a check</a>'}
      </div>
    `
        : `
      <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 divide-y">
        ${checks
          .map((check) => {
            const uptime7d = uptimeMap?.[check.id] || "—";
            const hs = healthMap?.[check.id] ?? -1;
            return `
          <a href="/dashboard/checks/${check.id}" class="block px-3 sm:px-4 py-3 hover:bg-gray-50">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2 min-w-0 flex-wrap">
                <span class="font-medium text-gray-900 dark:text-white truncate">${escapeHtml(check.name)}</span>
                ${statusBadge(check.status)}
                ${maintBadge(check)}
                ${check.group_name ? `<span class="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs">${escapeHtml(check.group_name)}</span>` : ""}
                ${renderTagPills(check.tags)}
                <span class="text-xs font-medium ${uptimeColor(uptime7d)} hidden sm:inline" title="7d uptime">${uptime7d}</span>
                <span class="hidden sm:inline">${healthScoreBadge(hs)}</span>
              </div>
              <div class="text-xs sm:text-sm text-gray-400 whitespace-nowrap ml-2">
                ${check.last_ping_at ? timeAgo(check.last_ping_at) : "Never"}
                &middot; ${formatDuration(check.period)}
              </div>
            </div>
          </a>`;
          })
          .join("")}
      </div>
    `
    }`;
}

function renderCheckForm(check?: Check): string {
  const isEdit = !!check;
  return `
    <div class="max-w-lg mx-auto">
      <h1 class="text-2xl font-bold mb-6">${isEdit ? "Edit Check" : "New Check"}</h1>
      <form method="POST" action="${isEdit ? `/dashboard/checks/${check!.id}` : "/dashboard/checks"}" class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg transition-colors duration-200 p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
          <input type="text" name="name" value="${isEdit ? escapeHtml(check!.name) : ""}" required
            class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900" placeholder="e.g. DB Backup">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cron Expression <span class="font-normal text-gray-400">(optional)</span></label>
          <input type="text" name="cron_expression" id="cron-input" value="${isEdit ? escapeHtml(check!.cron_expression || "") : ""}"
            class="w-full px-3 py-2 border rounded-md text-sm font-mono dark:text-gray-900" placeholder="*/5 * * * *">
          <div id="cron-preview" class="text-xs mt-1 text-gray-500 hidden"></div>
          <p class="text-xs text-gray-400 mt-1">Paste your crontab expression to auto-set period &amp; grace. Format: <code>min hour dom month dow</code></p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expected Period</label>
          <select name="period" id="period-select" class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900">
            ${periodOptions()
              .map(
                (o) =>
                  `<option value="${o.value}" ${check && check.period === o.value ? "selected" : ""}>${o.label}</option>`,
              )
              .join("")}
          </select>
          <p class="text-xs text-gray-400 mt-1">How often your cron job runs (auto-set when using cron expression)</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Grace Period</label>
          <select name="grace" id="grace-select" class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900">
            ${graceOptions()
              .map(
                (o) =>
                  `<option value="${o.value}" ${check && check.grace === o.value ? "selected" : ""}>${o.label}</option>`,
              )
              .join("")}
          </select>
          <p class="text-xs text-gray-400 mt-1">Extra time before alerting (auto-set when using cron expression)</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Group</label>
          <input type="text" name="group_name" value="${isEdit ? escapeHtml(check!.group_name || "") : ""}"
            class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900" placeholder="e.g. Production, Staging, Backups">
          <p class="text-xs text-gray-400 mt-1">Group name for organizing checks into folders</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tags</label>
          <input type="text" name="tags" value="${isEdit ? escapeHtml(check!.tags || "") : ""}"
            class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900" placeholder="e.g. production, database, backups">
          <p class="text-xs text-gray-400 mt-1">Comma-separated tags for organizing checks</p>
        </div>
        <fieldset class="border rounded-md p-4 space-y-3">
          <legend class="text-sm font-medium text-gray-700 px-1">Maintenance Window <span class="font-normal text-gray-400">(optional)</span></legend>
          <div>
            <label class="block text-xs text-gray-500 mb-1">One-time: Start</label>
            <input type="datetime-local" name="maint_start" value="${isEdit && check!.maint_start ? new Date(check!.maint_start * 1000).toISOString().slice(0, 16) : ""}"
              class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900">
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">One-time: End</label>
            <input type="datetime-local" name="maint_end" value="${isEdit && check!.maint_end ? new Date(check!.maint_end * 1000).toISOString().slice(0, 16) : ""}"
              class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900">
          </div>
          <p class="text-xs text-gray-400 dark:text-gray-300">Alerts are suppressed during this window. Leave both empty to disable.</p>
          <hr class="border-gray-200">
          <div>
            <label class="block text-xs text-gray-500 mb-1">Recurring Schedule</label>
            <select name="maint_schedule" class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900">
              <option value="">None</option>
              <option value="daily:02:00-04:00" ${isEdit && check!.maint_schedule === "daily:02:00-04:00" ? "selected" : ""}>Daily 02:00-04:00 UTC</option>
              <option value="daily:03:00-05:00" ${isEdit && check!.maint_schedule === "daily:03:00-05:00" ? "selected" : ""}>Daily 03:00-05:00 UTC</option>
              <option value="daily:04:00-06:00" ${isEdit && check!.maint_schedule === "daily:04:00-06:00" ? "selected" : ""}>Daily 04:00-06:00 UTC</option>
              <option value="sun:02:00-06:00" ${isEdit && check!.maint_schedule === "sun:02:00-06:00" ? "selected" : ""}>Sunday 02:00-06:00 UTC</option>
              <option value="sat:02:00-06:00" ${isEdit && check!.maint_schedule === "sat:02:00-06:00" ? "selected" : ""}>Saturday 02:00-06:00 UTC</option>
              <option value="sat,sun:00:00-06:00" ${isEdit && check!.maint_schedule === "sat,sun:00:00-06:00" ? "selected" : ""}>Weekends 00:00-06:00 UTC</option>
              <option value="weekdays:02:00-04:00" ${isEdit && check!.maint_schedule === "weekdays:02:00-04:00" ? "selected" : ""}>Weekdays 02:00-04:00 UTC</option>
              <option value="weekends:00:00-08:00" ${isEdit && check!.maint_schedule === "weekends:00:00-08:00" ? "selected" : ""}>Weekends 00:00-08:00 UTC</option>
              ${isEdit && check!.maint_schedule && !["", "daily:02:00-04:00", "daily:03:00-05:00", "daily:04:00-06:00", "sun:02:00-06:00", "sat:02:00-06:00", "sat,sun:00:00-06:00", "weekdays:02:00-04:00", "weekends:00:00-08:00"].includes(check!.maint_schedule) ? `<option value="${escapeHtml(check!.maint_schedule)}" selected>Custom: ${escapeHtml(check!.maint_schedule)}</option>` : ""}
            </select>
            <p class="text-xs text-gray-400 mt-1">Recurring window — alerts suppressed during this time every week. Use API for custom schedules.</p>
          </div>
        </fieldset>
        <div class="flex gap-3">
          <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
            ${isEdit ? "Save Changes" : "Create Check"}
          </button>
          <a href="/dashboard" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</a>
        </div>
      </form>
      <script>
      (function() {
        var cronInput = document.getElementById('cron-input');
        var preview = document.getElementById('cron-preview');
        var periodSelect = document.getElementById('period-select');
        var graceSelect = document.getElementById('grace-select');
        if (!cronInput) return;

        var ALIASES = {'@yearly':'0 0 1 1 *','@annually':'0 0 1 1 *','@monthly':'0 0 1 * *','@weekly':'0 0 * * 0','@daily':'0 0 * * *','@midnight':'0 0 * * *','@hourly':'0 * * * *'};

        function parseField(f, min, max) {
          var vals = [];
          f.split(',').forEach(function(part) {
            var sp = part.split('/'), rangePart = sp[0], step = sp[1] ? parseInt(sp[1]) : 1;
            if (isNaN(step) || step < 1) return;
            var start, end;
            if (rangePart === '*') { start = min; end = max; }
            else if (rangePart.indexOf('-') !== -1) { var r = rangePart.split('-'); start = parseInt(r[0]); end = parseInt(r[1]); }
            else { start = parseInt(rangePart); end = sp[1] ? max : start; }
            if (isNaN(start) || isNaN(end) || start < min || end > max) return;
            for (var i = start; i <= end; i += step) vals.push(i);
          });
          return vals.length ? vals : null;
        }

        function parseCron(expr) {
          var e = (expr || '').trim().toLowerCase();
          e = ALIASES[e] || e;
          var f = e.split(/\\s+/);
          if (f.length !== 5) return null;
          var mins = parseField(f[0],0,59), hrs = parseField(f[1],0,23), dom = parseField(f[2],1,31), mon = parseField(f[3],1,12), dow = parseField(f[4],0,6);
          if (!mins||!hrs||!dom||!mon||!dow) return null;

          var period = 3600;
          if (hrs.length===24 && dom.length===31 && mon.length===12 && dow.length===7 && mins.length>1) {
            var gaps=[]; for(var i=1;i<mins.length;i++) gaps.push(mins[i]-mins[i-1]);
            gaps.push(60-mins[mins.length-1]+mins[0]);
            if(gaps.every(function(g){return g===gaps[0];})) period=gaps[0]*60;
            else period=Math.round(3600/mins.length);
          } else if (mins.length===1 && dom.length===31 && mon.length===12 && dow.length===7 && hrs.length>1 && hrs.length<24) {
            var g2=[]; for(var j=1;j<hrs.length;j++) g2.push(hrs[j]-hrs[j-1]);
            g2.push(24-hrs[hrs.length-1]+hrs[0]);
            if(g2.every(function(g){return g===g2[0];})) period=g2[0]*3600;
            else period=Math.round(86400/hrs.length);
          } else if (mins.length===1 && hrs.length===24 && dom.length===31 && mon.length===12 && dow.length===7) { period=3600; }
          else if (mins.length===1 && hrs.length===1 && dom.length===31 && mon.length===12 && dow.length===7) { period=86400; }
          else if (mins.length===1 && hrs.length===1 && dom.length===31 && mon.length===12 && dow.length===1) { period=604800; }
          else if (mins.length===1 && hrs.length===1 && dom.length===31 && mon.length===12) { period=Math.round(604800/dow.length); }

          var grace = Math.min(3600, Math.max(60, Math.round(period*0.2)));
          var desc = 'Custom schedule';
          if (mins.length===60 && hrs.length===24 && dom.length===31 && mon.length===12 && dow.length===7) desc='Every minute';
          else if (hrs.length===24 && dom.length===31 && mon.length===12 && dow.length===7 && mins.length>1) {
            if(mins[0]===0 && mins.length>1) { var g=mins[1]-mins[0]; if(mins.every(function(m,i){return m===i*g;})) desc='Every '+g+' minutes'; else desc=mins.length+' times/hour'; }
            else desc=mins.length+' times/hour';
          }
          else if (mins.length===1 && hrs.length===24 && dom.length===31 && mon.length===12 && dow.length===7) desc='Every hour at :'+('0'+mins[0]).slice(-2);
          else if (mins.length===1 && hrs.length===1 && dom.length===31 && mon.length===12 && dow.length===7) desc='Daily at '+('0'+hrs[0]).slice(-2)+':'+('0'+mins[0]).slice(-2)+' UTC';
          else if (mins.length===1 && hrs.length===1 && dom.length===31 && mon.length===12 && dow.length<7) {
            var dn=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            desc=dow.map(function(d){return dn[d]}).join(', ')+' at '+('0'+hrs[0]).slice(-2)+':'+('0'+mins[0]).slice(-2)+' UTC';
          }
          return { period: period, grace: grace, desc: desc };
        }

        function fmtDur(s) {
          if (s < 60) return s+'s';
          if (s < 3600) return Math.floor(s/60)+'m';
          if (s < 86400) return Math.floor(s/3600)+'h';
          return Math.floor(s/86400)+'d';
        }

        function selectNearest(sel, val) {
          var opts = sel.options, best = 0, bestDiff = Infinity;
          for (var i = 0; i < opts.length; i++) {
            var d = Math.abs(parseInt(opts[i].value) - val);
            if (d < bestDiff) { bestDiff = d; best = i; }
          }
          sel.selectedIndex = best;
        }

        cronInput.addEventListener('input', function() {
          var val = cronInput.value.trim();
          if (!val) { preview.classList.add('hidden'); return; }
          var r = parseCron(val);
          if (!r) {
            preview.classList.remove('hidden');
            preview.className = 'text-xs mt-1 text-red-500';
            preview.textContent = 'Invalid cron expression';
            return;
          }
          preview.classList.remove('hidden');
          preview.className = 'text-xs mt-1 text-green-600';
          preview.textContent = r.desc + ' (period: ' + fmtDur(r.period) + ', grace: ' + fmtDur(r.grace) + ')';
          selectNearest(periodSelect, r.period);
          selectNearest(graceSelect, r.grace);
        });

        // Trigger on load if value exists
        if (cronInput.value.trim()) cronInput.dispatchEvent(new Event('input'));
      })();
      </script>
    </div>`;
}

function renderCheckDetail(
  check: Check,
  pings: any[],
  alerts: any[],
  appUrl: string,
  uptime?: { day1: string; day7: string; day30: string },
  healthScore?: number,
): string {
  const pingUrl = `${appUrl}/ping/${check.id}`;
  const up = uptime || { day1: "—", day7: "—", day30: "—" };
  const hs = healthScore ?? -1;
  return `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
      <div>
        <div class="flex items-center gap-3">
          <h1 class="text-xl sm:text-2xl font-bold">${escapeHtml(check.name)}</h1>
          ${healthScoreBadge(hs)}
        </div>
        ${check.group_name ? `<div class="flex items-center gap-1 mt-1"><span class="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs">${escapeHtml(check.group_name)}</span></div>` : ""}
        ${check.tags ? `<div class="flex flex-wrap gap-1 mt-1">${renderTagPills(check.tags)}</div>` : ""}
        <span class="text-sm text-gray-500">ID: ${check.id}</span>
      </div>
      <div class="flex flex-wrap gap-2">
        <a href="/dashboard/checks/${check.id}/edit" class="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">Edit</a>
        ${
          check.status === "paused"
            ? `
          <form method="POST" action="/dashboard/checks/${check.id}/resume" style="display:inline">
            <button class="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700">Resume</button>
          </form>
        `
            : `
          <form method="POST" action="/dashboard/checks/${check.id}/pause" style="display:inline">
            <button class="px-3 py-1.5 bg-yellow-500 text-white rounded text-sm hover:bg-yellow-600">Pause</button>
          </form>
        `
        }
        <form method="POST" action="/dashboard/checks/${check.id}/delete" style="display:inline"
          onsubmit="return confirm('Delete this check?')">
          <button class="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700">Delete</button>
        </form>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
      <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-3 sm:p-4">
        <p class="text-xs text-gray-500 uppercase">Status</p>
        <p class="text-lg font-semibold mt-1">${statusBadge(check.status)}</p>
      </div>
      <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-3 sm:p-4">
        <p class="text-xs text-gray-500 uppercase">Last Ping</p>
        <p class="text-lg font-semibold mt-1">${check.last_ping_at ? timeAgo(check.last_ping_at) : "Never"}</p>
      </div>
      <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-3 sm:p-4">
        <p class="text-xs text-gray-500 uppercase">Period</p>
        <p class="text-lg font-semibold mt-1">${formatDuration(check.period)}</p>
      </div>
      <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-3 sm:p-4">
        <p class="text-xs text-gray-500 uppercase">Total Pings</p>
        <p class="text-lg font-semibold mt-1">${check.ping_count}</p>
      </div>
    </div>

    <!-- Uptime -->
    <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-4 mb-6">
      <p class="text-sm font-medium mb-3">Uptime</p>
      <div class="flex flex-wrap gap-6">
        <div>
          <p class="text-xs text-gray-500">24 hours</p>
          <p class="text-xl font-bold ${uptimeColor(up.day1)}">${up.day1}</p>
        </div>
        <div>
          <p class="text-xs text-gray-500">7 days</p>
          <p class="text-xl font-bold ${uptimeColor(up.day7)}">${up.day7}</p>
        </div>
        <div>
          <p class="text-xs text-gray-500">30 days</p>
          <p class="text-xl font-bold ${uptimeColor(up.day30)}">${up.day30}</p>
        </div>
      </div>
    </div>

    <!-- Maintenance Window -->
    ${
      (check.maint_start && check.maint_end) || check.maint_schedule
        ? (() => {
            const ts = now();
            let sections = "";

            // One-time window
            if (check.maint_start && check.maint_end) {
              const isActive = ts >= check.maint_start && ts <= check.maint_end;
              const isScheduled = ts < check.maint_start;
              const startStr =
                new Date(check.maint_start * 1000)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 16) + " UTC";
              const endStr =
                new Date(check.maint_end * 1000)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 16) + " UTC";
              const badge = isActive
                ? '<span class="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">Active</span>'
                : isScheduled
                  ? '<span class="px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-600">Scheduled</span>'
                  : '<span class="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">Expired</span>';
              sections += `<div class="flex items-center gap-2"><span class="text-xs text-gray-500">One-time:</span> ${badge}</div>
          <p class="text-sm text-gray-600">${startStr} &mdash; ${endStr}</p>`;
            }

            // Recurring schedule
            if (check.maint_schedule) {
              const isRecurringActive = isInMaintSchedule(
                check.maint_schedule,
                ts,
              );
              const recurBadge = isRecurringActive
                ? '<span class="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">Active Now</span>'
                : '<span class="px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-600">Recurring</span>';
              sections += `${sections ? '<hr class="border-gray-200 my-2">' : ""}
          <div class="flex items-center gap-2"><span class="text-xs text-gray-500">Recurring:</span> ${recurBadge}</div>
          <p class="text-sm text-gray-600">${formatMaintSchedule(check.maint_schedule)}</p>`;
            }

            return `<div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-4 mb-6">
      <div class="flex items-center gap-2 mb-2">
        <p class="text-sm font-medium">Maintenance Window</p>
      </div>
      ${sections}
      <p class="text-xs text-gray-400 mt-2">Alerts are suppressed during maintenance windows.</p>
    </div>`;
          })()
        : ""
    }

    <!-- Ping Timeline Sparkline -->
    <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-4 mb-6">
      <p class="text-sm font-medium mb-3">Ping Timeline <span class="text-xs text-gray-400 font-normal">(last ${Math.min(pings.length, 30)} pings)</span></p>
      <div class="overflow-x-auto">${renderSparkline(pings)}</div>
    </div>

    ${
      check.cron_expression
        ? `
    <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-4 mb-6">
      <p class="text-sm font-medium mb-2">Cron Schedule</p>
      <code class="bg-gray-100 px-3 py-1.5 rounded text-sm font-mono">${escapeHtml(check.cron_expression)}</code>
    </div>
    `
        : ""
    }

    <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-4 mb-6">
      <p class="text-sm font-medium mb-2">Ping URLs</p>
      <div class="space-y-3">
        <div>
          <p class="text-xs text-gray-500 mb-1">Success (default)</p>
          <div class="flex items-center gap-2">
            <div class="overflow-x-auto flex-1">
              <code id="ping-url" class="bg-gray-100 px-3 py-1.5 rounded text-sm block whitespace-nowrap">${pingUrl}</code>
            </div>
            <button onclick="copyToClipboard('${pingUrl}', this)" class="shrink-0 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm text-gray-600 transition-colors" title="Copy URL">Copy</button>
          </div>
        </div>
        <div>
          <p class="text-xs text-gray-500 mb-1">Start signal <span class="text-gray-400">(marks job as running)</span></p>
          <div class="flex items-center gap-2">
            <div class="overflow-x-auto flex-1">
              <code class="bg-gray-100 px-3 py-1.5 rounded text-sm block whitespace-nowrap">${pingUrl}/start</code>
            </div>
            <button onclick="copyToClipboard('${pingUrl}/start', this)" class="shrink-0 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm text-gray-600 transition-colors" title="Copy URL">Copy</button>
          </div>
        </div>
        <div>
          <p class="text-xs text-gray-500 mb-1">Fail signal <span class="text-gray-400">(reports failure, triggers alert)</span></p>
          <div class="flex items-center gap-2">
            <div class="overflow-x-auto flex-1">
              <code class="bg-red-50 px-3 py-1.5 rounded text-sm block whitespace-nowrap">${pingUrl}/fail</code>
            </div>
            <button onclick="copyToClipboard('${pingUrl}/fail', this)" class="shrink-0 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm text-gray-600 transition-colors" title="Copy URL">Copy</button>
          </div>
        </div>
      </div>
      <p class="text-xs text-gray-400 mt-3">Usage: <code class="bg-gray-100 px-1 py-0.5 rounded">curl ${pingUrl}/start && your-job && curl ${pingUrl} || curl ${pingUrl}/fail</code></p>
    </div>

    <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-4 mb-6">
      <p class="text-sm font-medium mb-2">Status Badge</p>
      <div class="flex items-center gap-3 mb-3">
        <img src="${appUrl}/badge/${check.id}" alt="status badge" />
        <img src="${appUrl}/badge/${check.id}/uptime" alt="uptime badge" />
      </div>
      <div class="space-y-2">
        <div>
          <p class="text-xs text-gray-500 mb-1">Markdown</p>
          <div class="flex items-center gap-2">
            <code id="badge-md" class="bg-gray-100 px-3 py-1.5 rounded text-xs block whitespace-nowrap overflow-x-auto flex-1">[![CronPulse](${appUrl}/badge/${check.id})](${appUrl}?utm_source=badge&amp;utm_medium=referral)</code>
            <button onclick="copyToClipboard('[![CronPulse](${appUrl}/badge/${check.id})](${appUrl}?utm_source=badge&utm_medium=referral)', this)" class="shrink-0 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-600 transition-colors">Copy</button>
          </div>
        </div>
        <div>
          <p class="text-xs text-gray-500 mb-1">HTML</p>
          <div class="flex items-center gap-2">
            <code class="bg-gray-100 px-3 py-1.5 rounded text-xs block whitespace-nowrap overflow-x-auto flex-1">&lt;a href="${appUrl}?utm_source=badge&amp;utm_medium=referral"&gt;&lt;img src="${appUrl}/badge/${check.id}" alt="CronPulse status" /&gt;&lt;/a&gt;</code>
            <button onclick="copyToClipboard('<a href=&quot;${appUrl}?utm_source=badge&amp;utm_medium=referral&quot;><img src=&quot;${appUrl}/badge/${check.id}&quot; alt=&quot;CronPulse status&quot; /></a>', this)" class="shrink-0 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-600 transition-colors">Copy</button>
          </div>
        </div>
      </div>
    </div>

    <script>
    function copyToClipboard(text, btn) {
      navigator.clipboard.writeText(text).then(function() {
        var orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('bg-green-100', 'text-green-700');
        btn.classList.remove('bg-gray-100', 'text-gray-600');
        setTimeout(function() {
          btn.textContent = orig;
          btn.classList.remove('bg-green-100', 'text-green-700');
          btn.classList.add('bg-gray-100', 'text-gray-600');
        }, 2000);
      });
    }
    </script>

    <div class="grid md:grid-cols-2 gap-6">
      <div>
        <h2 class="text-lg font-semibold mb-3">Recent Pings</h2>
        <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 divide-y max-h-80 overflow-y-auto">
          ${
            pings.length === 0
              ? '<p class="p-4 text-sm text-gray-400">No pings received yet.</p>'
              : pings
                  .map((p: any) => {
                    const typeColor =
                      p.type === "success"
                        ? "text-green-600"
                        : p.type === "start"
                          ? "text-blue-600"
                          : "text-red-600";
                    return `
              <div class="px-3 sm:px-4 py-2 flex justify-between text-sm">
                <span class="text-gray-600 text-xs sm:text-sm">${new Date(p.timestamp * 1000).toISOString().replace("T", " ").slice(0, 19)}</span>
                <span class="${typeColor}">${p.type}</span>
              </div>`;
                  })
                  .join("")
          }
        </div>
      </div>
      <div>
        <h2 class="text-lg font-semibold mb-3">Recent Alerts</h2>
        <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 divide-y max-h-80 overflow-y-auto">
          ${
            alerts.length === 0
              ? '<p class="p-4 text-sm text-gray-400">No alerts sent yet.</p>'
              : alerts
                  .map(
                    (a: any) => `
              <div class="px-3 sm:px-4 py-2 flex justify-between text-sm gap-2">
                <span class="text-gray-600 text-xs sm:text-sm">${new Date(a.created_at * 1000).toISOString().replace("T", " ").slice(0, 19)}</span>
                <span class="${a.type === "recovery" ? "text-green-600" : "text-red-600"}">${a.type}</span>
                <span class="${a.status === "sent" ? "text-green-600" : "text-red-600"}">${a.status}</span>
              </div>
            `,
                  )
                  .join("")
          }
        </div>
      </div>
    </div>`;
}

function renderIncidentTimeline(
  alerts: any[],
  page: number,
  totalPages: number,
  total: number,
  checks?: { id: string; name: string }[],
  checkFilter?: string,
  typeFilter?: string,
): string {
  // Group alerts by date
  const grouped: Record<string, any[]> = {};
  for (const alert of alerts) {
    const date = new Date(alert.created_at * 1000).toISOString().slice(0, 10);
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(alert);
  }

  // Build query string for pagination links, preserving filters
  function qs(p: number): string {
    const parts: string[] = [`page=${p}`];
    if (checkFilter) parts.push(`check=${encodeURIComponent(checkFilter)}`);
    if (typeFilter) parts.push(`type=${encodeURIComponent(typeFilter)}`);
    return parts.join("&");
  }

  const pagination =
    totalPages > 1
      ? `
    <div class="flex items-center justify-between mt-6 text-sm">
      <span class="text-gray-500">${total} incidents total</span>
      <div class="flex items-center gap-2">
        ${page > 1 ? `<a href="/dashboard/incidents?${qs(page - 1)}" class="px-3 py-1 border rounded hover:bg-gray-50">Prev</a>` : `<span class="px-3 py-1 border rounded text-gray-300">Prev</span>`}
        <span class="text-gray-600">Page ${page} of ${totalPages}</span>
        ${page < totalPages ? `<a href="/dashboard/incidents?${qs(page + 1)}" class="px-3 py-1 border rounded hover:bg-gray-50">Next</a>` : `<span class="px-3 py-1 border rounded text-gray-300">Next</span>`}
      </div>
    </div>
  `
      : "";

  const hasFilters = checkFilter || typeFilter;

  const filterBar = `
    <form method="GET" action="/dashboard/incidents" class="flex flex-wrap items-end gap-3 mb-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 transition-colors duration-200 p-4">
      <div>
        <label class="block text-xs font-medium text-gray-500 mb-1 dark:text-gray-300">Check</label>
        <select name="check" class="px-3 py-1.5 border rounded-md text-sm dark:text-gray-600">
          <option value="">All checks</option>
          ${(checks || []).map((ch) => `<option value="${ch.id}" ${checkFilter === ch.id ? "selected" : ""}>${escapeHtml(ch.name)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-500 mb-1 dark:text-gray-300">Type</label>
        <select name="type" class="px-3 py-1.5 border rounded-md text-sm dark:text-gray-600">
          <option value="">All types</option>
          <option value="down" ${typeFilter === "down" ? "selected" : ""}>Down</option>
          <option value="recovery" ${typeFilter === "recovery" ? "selected" : ""}>Recovery</option>
        </select>
      </div>
      <button type="submit" class="px-4 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700">Filter</button>
      ${hasFilters ? `<a href="/dashboard/incidents" class="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Clear</a>` : ""}
    </form>
  `;

  return `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Incident Timeline</h1>
    </div>
    ${filterBar}
    ${
      alerts.length === 0
        ? `
      <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-12 text-center">
        <p class="text-gray-500">${hasFilters ? "No incidents match your filters." : "No incidents yet. Your checks are running smoothly!"}</p>
        ${hasFilters ? '<a href="/dashboard/incidents" class="text-blue-600 hover:underline text-sm mt-2 inline-block">Clear filters</a>' : ""}
      </div>
    `
        : `
      <div class="space-y-6">
        ${Object.entries(grouped)
          .map(
            ([date, dayAlerts]) => `
          <div>
            <h2 class="text-sm font-semibold text-gray-500 mb-3">${date}</h2>
            <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 divide-y">
              ${dayAlerts
                .map((a: any) => {
                  const time = new Date(a.created_at * 1000)
                    .toISOString()
                    .replace("T", " ")
                    .slice(11, 19);
                  const isDown = a.type === "down";
                  const icon = isDown
                    ? '<span class="text-red-500">&#9660;</span>'
                    : '<span class="text-green-500">&#9650;</span>';
                  const label = isDown ? "went DOWN" : "recovered";
                  const labelColor = isDown ? "text-red-600" : "text-green-600";
                  const statusBg =
                    a.status === "sent"
                      ? "bg-green-50 text-green-700"
                      : "bg-red-50 text-red-700";
                  return `
                <div class="px-4 py-3 flex items-start gap-3">
                  <div class="mt-0.5">${icon}</div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <a href="/dashboard/checks/${a.check_id}" class="font-medium text-gray-900 hover:text-blue-600 truncate">${escapeHtml(a.check_name || a.check_id)}</a>
                      <span class="text-sm ${labelColor}">${label}</span>
                      <span class="text-xs px-1.5 py-0.5 rounded ${statusBg}">${a.status}</span>
                    </div>
                    ${a.error ? `<p class="text-xs text-red-500 mt-1">${escapeHtml(a.error)}</p>` : ""}
                  </div>
                  <span class="text-xs text-gray-400 whitespace-nowrap">${time}</span>
                </div>`;
                })
                .join("")}
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
      ${pagination}
    `
    }`;
}

function renderChannels(channels: Channel[]): string {
  return `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Notification Channels</h1>
    </div>

    <div class="max-w-lg">
      <form method="POST" action="/dashboard/channels" class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 transition-colors duration-200 p-6 space-y-4 mb-6">
        <h2 class="font-semibold">Add Channel</h2>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
          <select name="kind" class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-600">
            <option value="email">Email</option>
            <option value="webhook">Webhook</option>
            <option value="slack">Slack Webhook</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target</label>
          <input type="text" name="target" required class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900"
            placeholder="email@example.com or https://...">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
          <input type="text" name="name" class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900" placeholder="My Slack">
        </div>
        <label class="flex items-center gap-2 text-sm dark:text-gray-300">
          <input type="checkbox" name="is_default" value="1"> Use as default for new checks
        </label>
        <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
          Add Channel
        </button>
      </form>

      <!-- Slack Setup Guide -->
      <details class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 transition-colors duration-200 p-6 mb-6">
        <summary class="font-semibold cursor-pointer text-sm">How to set up Slack notifications</summary>
        <div class="mt-3 text-sm text-gray-600 space-y-3">
          <ol class="list-decimal pl-5 space-y-2">
            <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener" class="text-blue-600 hover:underline">api.slack.com/apps</a> and click <strong>Create New App</strong> &rarr; <strong>From scratch</strong>.</li>
            <li>Name your app (e.g. "CronPulse") and select your workspace.</li>
            <li>In the left sidebar, click <strong>Incoming Webhooks</strong> and toggle it <strong>On</strong>.</li>
            <li>Click <strong>Add New Webhook to Workspace</strong> and choose a channel (e.g. #alerts).</li>
            <li>Copy the webhook URL (starts with <code>https://hooks.slack.com/services/...</code>).</li>
            <li>Paste it above as a <strong>Slack Webhook</strong> channel.</li>
          </ol>
          <p class="text-xs text-gray-400 dark:text-gray-300">CronPulse sends JSON payloads with <code>text</code> field, compatible with Slack incoming webhooks.</p>
        </div>
      </details>

      ${
        channels.length === 0
          ? '<p class="text-sm text-gray-400">No channels configured.</p>'
          : `
        <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 divide-y">
          ${channels
            .map(
              (ch) => `
            <div class="px-4 py-3 flex items-center justify-between">
              <div>
                <span class="font-medium text-sm">${escapeHtml(ch.name || ch.kind)}</span>
                <span class="text-xs text-gray-400 ml-2">${ch.kind}</span>
                ${ch.is_default ? '<span class="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded ml-2">default</span>' : ""}
                <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(ch.target)}</p>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <form method="POST" action="/dashboard/channels/${ch.id}/test" style="display:inline">
                  <button class="text-blue-600 text-xs hover:underline">Test</button>
                </form>
                <form method="POST" action="/dashboard/channels/${ch.id}/delete" style="display:inline">
                  <button class="text-red-500 text-xs hover:underline">Delete</button>
                </form>
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      `
      }
    </div>`;
}

function renderSettings(user: User): string {
  const hasApiAccess = user.plan === "pro" || user.plan === "business";
  return `
    <div class="max-w-lg">
      <h1 class="text-2xl font-bold mb-6">Settings</h1>
      <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-6 space-y-4">
        <div>
          <p class="text-sm font-medium text-gray-700">Email</p>
          <p class="text-gray-900 dark:text-white">${escapeHtml(user.email)}</p>
        </div>
        <div>
          <p class="text-sm font-medium text-gray-700">Plan</p>
          <p class="text-gray-900 dark:text-white capitalize">${user.plan} (${user.check_limit} checks)</p>
        </div>
        <div>
          <p class="text-sm font-medium text-gray-700">Member since</p>
          <p class="text-gray-900 dark:text-white">${new Date(user.created_at * 1000).toISOString().slice(0, 10)}</p>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-6 mt-6">
        <h2 class="font-semibold mb-3">API Access</h2>
        ${
          hasApiAccess
            ? `
          <p class="text-sm text-gray-600 mb-3">${user.api_key_hash ? "You have an active API key." : "Generate an API key to manage checks programmatically."}</p>
          <form method="POST" action="/dashboard/settings/api-key">
            <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
              onclick="return ${user.api_key_hash ? "confirm('This will replace your existing API key. Continue?')" : "true"}">
              ${user.api_key_hash ? "Regenerate API Key" : "Generate API Key"}
            </button>
          </form>
          <p class="text-xs text-gray-400 mt-3">API docs: <code>GET/POST/PATCH/DELETE /api/v1/checks</code></p>
        `
            : `
          <p class="text-sm text-gray-500">API access is available on Pro and Business plans.</p>
          <a href="/dashboard/billing" class="text-blue-600 hover:underline text-sm mt-2 inline-block">Upgrade your plan</a>
        `
        }
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-6 mt-6">
        <h2 class="font-semibold mb-3">Webhook Signing Secret</h2>
        <p class="text-sm text-gray-600 mb-3">${
          user.webhook_signing_secret
            ? "Outgoing webhook notifications are signed with HMAC-SHA256. Verify the <code>X-CronPulse-Signature</code> header to ensure authenticity."
            : "Generate a signing secret to verify the authenticity of webhook notifications from CronPulse."
        }</p>
        ${
          user.webhook_signing_secret
            ? `
          <p class="text-xs text-gray-500 mb-3">Secret: <code>${user.webhook_signing_secret.slice(0, 10)}${"*".repeat(20)}</code></p>
        `
            : ""
        }
        <form method="POST" action="/dashboard/settings/webhook-secret">
          <button type="submit" class="bg-gray-800 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-900"
            onclick="return ${user.webhook_signing_secret ? "confirm('This will replace your existing signing secret. All webhook consumers must update their verification. Continue?')" : "true"}">
            ${user.webhook_signing_secret ? "Regenerate Secret" : "Generate Signing Secret"}
          </button>
        </form>
        <p class="text-xs text-gray-400 mt-3">See <a href="/docs#webhook-signatures" class="text-blue-600 hover:underline">docs</a> for verification instructions.</p>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 p-6 mt-6">
        <h2 class="font-semibold mb-3">Public Status Page</h2>
        <p class="text-sm text-gray-600 mb-3">Customize your public status page at <a href="/status/${user.id}" class="text-blue-600 hover:underline">/status/${user.id}</a>. Share it with your team or users.</p>
        <form method="POST" action="/dashboard/settings/status-page" class="space-y-3">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" name="status_page_public" value="1" ${user.status_page_public ? "checked" : ""}>
            Enable public status page
          </label>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Page Title</label>
            <input type="text" name="status_page_title" value="${escapeHtml(user.status_page_title || "")}"
              class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900" placeholder="e.g. Acme Corp Status">
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Logo URL</label>
            <input type="url" name="status_page_logo_url" value="${escapeHtml(user.status_page_logo_url || "")}"
              class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900" placeholder="https://example.com/logo.png">
            <p class="text-xs text-gray-400 mt-1">Must be an HTTPS URL. Recommended: 200x50px or similar.</p>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Description</label>
            <input type="text" name="status_page_description" value="${escapeHtml(user.status_page_description || "")}"
              class="w-full px-3 py-2 border rounded-md text-sm dark:text-gray-900" placeholder="e.g. Real-time status of our scheduled tasks">
          </div>
          <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">Save Status Page Settings</button>
        </form>
      </div>
    </div>`;
}

function renderBilling(user: User, storeUrl: string): string {
  const plans = [
    {
      name: "Free",
      price: "$0",
      period: "forever",
      checks: 10,
      features: ["Email alerts", "7 day history", "5 min interval"],
      current: user.plan === "free",
    },
    {
      name: "Starter",
      price: "$5",
      period: "/mo",
      checks: 50,
      features: ["Email + Webhook + Slack", "30 day history", "1 min interval"],
      current: user.plan === "starter",
      popular: true,
    },
    {
      name: "Pro",
      price: "$15",
      period: "/mo",
      checks: 200,
      features: ["All notifications", "90 day history", "API access"],
      current: user.plan === "pro",
    },
    {
      name: "Business",
      price: "$49",
      period: "/mo",
      checks: 1000,
      features: [
        "All notifications",
        "1 year history",
        "API access",
        "Priority support",
      ],
      current: user.plan === "business",
    },
  ];

  return `
    <div class="max-w-3xl mx-auto">
      <h1 class="text-2xl font-bold mb-2">Billing</h1>
      <p class="text-sm text-gray-500 mb-6">Current plan: <span class="font-medium capitalize">${user.plan}</span> (${user.check_limit} checks)</p>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${plans
          .map(
            (plan) => `
          <div class="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 duration-200 ${plan.current ? "border-blue-500 ring-1 ring-blue-500" : ""} ${plan.popular ? "border-blue-500" : ""} p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold">${plan.name}</h3>
              ${plan.current ? '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Current</span>' : ""}
              ${plan.popular && !plan.current ? '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Popular</span>' : ""}
            </div>
            <p class="text-2xl font-bold">${plan.price}<span class="text-sm font-normal text-gray-500">${plan.period}</span></p>
            <p class="text-sm text-gray-500 mt-1">${plan.checks} checks</p>
            <ul class="mt-3 space-y-1">
              ${plan.features.map((f) => `<li class="text-sm text-gray-600">&#10003; ${f}</li>`).join("")}
            </ul>
            ${
              plan.current
                ? '<p class="mt-4 text-center text-sm text-gray-400">Your current plan</p>'
                : plan.name === "Free"
                  ? ""
                  : `<a href="${storeUrl || "#"}" target="_blank" rel="noopener"
                    class="block mt-4 text-center bg-blue-600 text-white py-2 rounded text-sm font-medium hover:bg-blue-700">
                    ${user.plan === "free" ? "Upgrade" : "Change Plan"}
                  </a>`
            }
          </div>
        `,
          )
          .join("")}
      </div>

      ${
        user.plan !== "free"
          ? `
        <div class="mt-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg transition-colors duration-200 p-4">
          <p class="text-sm text-gray-600">Need to manage your subscription? <a href="${storeUrl || "#"}" target="_blank" rel="noopener" class="text-blue-600 hover:underline">Manage billing</a></p>
        </div>
      `
          : ""
      }
    </div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default dashboard;
