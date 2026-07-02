"""
Usage dashboard endpoints — all scoped to a single config.
Phase 1 Data Contract implementation.
"""
import math
from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from datetime import datetime, timedelta, timezone

from db import get_db_connection
from router_manager import _configs

router = APIRouter(prefix="/llm", tags=["usage_dashboard"])


def _resolve_range(range_str: str) -> Optional[datetime]:
    """Convert a range string to a UTC cutoff datetime. Returns None for 'all'."""
    now = datetime.now(timezone.utc)
    mapping = {
        "24h": timedelta(hours=24),
        "7d": timedelta(days=7),
        "30d": timedelta(days=30),
    }
    delta = mapping.get(range_str)
    if delta:
        return now - delta
    return None  # 'all'


def _auto_bucket(range_str: str) -> str:
    """Pick a sensible default bucket size based on the range."""
    if range_str == "24h":
        return "1h"
    return "1d"


def _sqlite_bucket_expr(bucket: str) -> str:
    """Return a SQLite expression that truncates created_at to the bucket boundary."""
    if bucket == "1h":
        # Truncate to hour: '2026-07-01T14:xx:xx' -> '2026-07-01T14:00:00'
        return "substr(created_at, 1, 13) || ':00:00'"
    else:
        # Truncate to day: '2026-07-01Txx:xx:xx' -> '2026-07-01T00:00:00'
        return "substr(created_at, 1, 10) || 'T00:00:00'"


def _where_clause(config_name: str, cutoff: Optional[datetime]) -> tuple[str, list]:
    """Build the WHERE clause + params for a config + optional time filter."""
    if cutoff:
        return "WHERE config_full_name = ? AND created_at >= ?", [config_name, cutoff.isoformat()]
    return "WHERE config_full_name = ?", [config_name]


def _percentile(values: list[float], p: float) -> float:
    """Compute the p-th percentile of a sorted list."""
    if not values:
        return 0.0
    values = sorted(values)
    k = (len(values) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return values[int(k)]
    return values[f] * (c - k) + values[c] * (k - f)


# ─── 1. Summary ───────────────────────────────────────────────────────────────

@router.get("/{config_name}/usage/summary")
async def usage_summary(config_name: str, range: str = Query("7d", regex="^(24h|7d|30d|all)$")):
    cutoff = _resolve_range(range)

    def _compute_period(cutoff_start: Optional[datetime], cutoff_end: Optional[datetime] = None):
        with get_db_connection() as conn:
            cursor = conn.cursor()

            where = "WHERE config_full_name = ?"
            params = [config_name]
            if cutoff_start:
                where += " AND created_at >= ?"
                params.append(cutoff_start.isoformat())
            if cutoff_end:
                where += " AND created_at < ?"
                params.append(cutoff_end.isoformat())

            cursor.execute(f'''
                SELECT
                    COUNT(*) as calls,
                    SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as success_count,
                    COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                    COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                    COALESCE(SUM(total_tokens), 0) as total_tokens,
                    COALESCE(SUM(cost), 0.0) as cost,
                    SUM(CASE WHEN fallback_triggered=1 THEN 1 ELSE 0 END) as fallback_triggers
                FROM usage_logs {where}
            ''', params)
            row = dict(cursor.fetchone())

            calls = row["calls"] or 0
            success_count = row["success_count"] or 0
            success_rate = round(success_count / calls, 4) if calls > 0 else 0.0

            # p95 latency from success calls only
            cursor.execute(f'''
                SELECT latency_ms FROM usage_logs
                {where} AND success=1 AND latency_ms IS NOT NULL
                ORDER BY latency_ms
            ''', params)
            latencies = [r[0] for r in cursor.fetchall()]
            p95 = round(_percentile(latencies, 0.95), 1)

        return {
            "calls": calls,
            "success_rate": success_rate,
            "prompt_tokens": row["prompt_tokens"],
            "completion_tokens": row["completion_tokens"],
            "total_tokens": row["total_tokens"],
            "cost": round(row["cost"], 6),
            "p95_latency_ms": p95,
            "fallback_triggers": row["fallback_triggers"] or 0
        }

    current = _compute_period(cutoff)

    previous = None
    if cutoff:
        # Previous period is the same duration BEFORE the cutoff
        now = datetime.now(timezone.utc)
        duration = now - cutoff
        prev_start = cutoff - duration
        previous = _compute_period(prev_start, cutoff)

    return {
        "current_period": current,
        "previous_period": previous
    }


# ─── 2. Timeseries ────────────────────────────────────────────────────────────

@router.get("/{config_name}/usage/timeseries")
async def usage_timeseries(
    config_name: str,
    range: str = Query("7d", regex="^(24h|7d|30d|all)$"),
    bucket: Optional[str] = Query(None, regex="^(1h|1d)$")
):
    cutoff = _resolve_range(range)
    bucket = bucket or _auto_bucket(range)
    bucket_expr = _sqlite_bucket_expr(bucket)

    where, params = _where_clause(config_name, cutoff)

    # Get config limits
    config = _configs.get(config_name)
    tpm_limit = config.restrictions.tpm if config else None
    rpm_limit = config.restrictions.rpm if config else None

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Main aggregation per display bucket
        cursor.execute(f'''
            SELECT
                {bucket_expr} as bucket_ts,
                COUNT(*) as calls,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                COALESCE(SUM(total_tokens), 0) as total_tokens,
                COALESCE(SUM(cost), 0.0) as cost,
                AVG(CASE WHEN success=1 THEN latency_ms END) as avg_latency_ms,
                GROUP_CONCAT(CASE WHEN success=1 THEN latency_ms END) as latency_list
            FROM usage_logs {where}
            GROUP BY bucket_ts
            ORDER BY bucket_ts
        ''', params)

        rows = cursor.fetchall()

        # Compute peak_tpm and peak_rpm per display bucket
        # First, bucket at 1-minute granularity
        minute_expr = "substr(created_at, 1, 16)"  # 'YYYY-MM-DDTHH:MM'
        cursor.execute(f'''
            SELECT
                {bucket_expr} as bucket_ts,
                {minute_expr} as minute_ts,
                COALESCE(SUM(total_tokens), 0) as minute_tokens,
                COUNT(*) as minute_requests
            FROM usage_logs {where}
            GROUP BY bucket_ts, minute_ts
        ''', params)

        minute_rows = cursor.fetchall()

    # Build peak lookup: bucket -> (max_tpm, max_rpm)
    peaks = {}
    for mr in minute_rows:
        bt = mr[0]
        toks = mr[2]
        reqs = mr[3]
        if bt not in peaks:
            peaks[bt] = {"peak_tpm": 0, "peak_rpm": 0}
        if toks > peaks[bt]["peak_tpm"]:
            peaks[bt]["peak_tpm"] = toks
        if reqs > peaks[bt]["peak_rpm"]:
            peaks[bt]["peak_rpm"] = reqs

    data = []
    for row in rows:
        row = dict(row)
        bt = row["bucket_ts"]

        # Compute p95 latency from the concatenated list
        latency_str = row.pop("latency_list", None)
        latencies = []
        if latency_str:
            latencies = [float(x) for x in latency_str.split(",") if x]
        p95 = round(_percentile(latencies, 0.95), 1) if latencies else 0.0

        peak = peaks.get(bt, {"peak_tpm": 0, "peak_rpm": 0})

        data.append({
            "timestamp": bt,
            "calls": row["calls"],
            "prompt_tokens": row["prompt_tokens"],
            "completion_tokens": row["completion_tokens"],
            "total_tokens": row["total_tokens"],
            "cost": round(row["cost"], 6),
            "avg_latency_ms": round(row["avg_latency_ms"], 1) if row["avg_latency_ms"] else 0.0,
            "p95_latency_ms": p95,
            "peak_tpm": peak["peak_tpm"],
            "peak_rpm": peak["peak_rpm"]
        })

    return {
        "config_limits": {
            "tpm_limit": tpm_limit,
            "rpm_limit": rpm_limit
        },
        "data": data
    }


# ─── 3. By-Model Breakdown ────────────────────────────────────────────────────

@router.get("/{config_name}/usage/by-model")
async def usage_by_model(config_name: str, range: str = Query("7d", regex="^(24h|7d|30d|all)$")):
    cutoff = _resolve_range(range)
    where, params = _where_clause(config_name, cutoff)

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Total successful calls for share calculation
        cursor.execute(f'''
            SELECT COUNT(*) FROM usage_logs {where} AND success=1
        ''', params)
        total_success = cursor.fetchone()[0] or 1  # avoid division by zero

        cursor.execute(f'''
            SELECT
                model_used,
                COUNT(*) as calls,
                SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as success_calls,
                SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as failed_calls,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                COALESCE(SUM(total_tokens), 0) as total_tokens,
                COALESCE(SUM(cost), 0.0) as cost,
                SUM(CASE WHEN fallback_triggered=1 THEN 1 ELSE 0 END) as fallback_count
            FROM usage_logs {where} AND model_used IS NOT NULL
            GROUP BY model_used
            ORDER BY calls DESC
        ''', params)

        results = []
        for row in cursor.fetchall():
            row = dict(row)
            row["cost"] = round(row["cost"], 6)
            row["share_percentage"] = round(row["success_calls"] / total_success, 4) if total_success else 0.0
            results.append(row)

    # Add failed calls with no model_used as a separate entry
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f'''
            SELECT COUNT(*) as calls
            FROM usage_logs {where} AND model_used IS NULL AND success=0
        ''', params)
        null_model_fails = cursor.fetchone()[0] or 0

    if null_model_fails > 0:
        results.append({
            "model_used": "(all models failed)",
            "calls": null_model_fails,
            "success_calls": 0,
            "failed_calls": null_model_fails,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost": 0.0,
            "fallback_count": 0,
            "share_percentage": 0.0
        })

    return results


# ─── 4. By-Operation Split ────────────────────────────────────────────────────

@router.get("/{config_name}/usage/by-operation")
async def usage_by_operation(config_name: str, range: str = Query("7d", regex="^(24h|7d|30d|all)$")):
    cutoff = _resolve_range(range)
    where, params = _where_clause(config_name, cutoff)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f'''
            SELECT
                endpoint as operation,
                COUNT(*) as calls,
                COALESCE(SUM(total_tokens), 0) as total_tokens,
                COALESCE(SUM(cost), 0.0) as cost
            FROM usage_logs {where}
            GROUP BY endpoint
            ORDER BY calls DESC
        ''', params)
        results = []
        for row in cursor.fetchall():
            row = dict(row)
            row["cost"] = round(row["cost"], 6)
            results.append(row)

    return results


# ─── 5. Recent Logs ───────────────────────────────────────────────────────────

@router.get("/{config_name}/logs/recent")
async def recent_logs(config_name: str, limit: int = Query(50, ge=1, le=200)):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT
                id,
                created_at as timestamp,
                endpoint as operation,
                model_used,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                cost,
                latency_ms,
                success,
                finish_reason,
                error_type,
                fallback_triggered
            FROM usage_logs
            WHERE config_full_name = ?
            ORDER BY id DESC
            LIMIT ?
        ''', (config_name, limit))
        results = []
        for row in cursor.fetchall():
            row = dict(row)
            row["success"] = bool(row["success"])
            row["fallback_triggered"] = bool(row["fallback_triggered"])
            row["cost"] = round(row["cost"] or 0.0, 6)
            results.append(row)

    return results
