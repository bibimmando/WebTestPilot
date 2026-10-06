"""Action/evidence layer: snapshot registry, AI input persistence, action context.
No collector/crawl imports (avoid cycles). Registry is bounded by collector max_pages
(ceiling: all registered snapshots are kept in memory for callback lookup)."""
import asyncio
import contextlib
import copy
import json
import pathlib
import re
import time
import uuid
import weakref

from .preprocess import assign_element_keys, diff_snapshots, build_ai_input, get_by_element_key

ACTION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SNAP_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
MSG_MAX = 500


def _err(exc, sanitize):
    msg = str(exc)[:MSG_MAX]
    try:
        msg = sanitize(msg)
    except Exception:
        msg = "<unsanitizable>"
    return {"type": type(exc).__name__, "message": msg if isinstance(msg, str) else str(msg)[:MSG_MAX]}


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


class SnapshotAPI:
    def __init__(self, collector):
        self.collector = collector
        self.snapshots = {}
        self.ai_inputs = {}
        self.private_links = {}  # 실제 URL은 순회용 메모리에만 보관한다.
        self.last_snapshot = None
        self.records = []
        self.active_action_id = None
        self._busy = False
        self._used_ids = set()
        self._origins = weakref.WeakKeyDictionary()
        self._origins_fallback = {}  # id(obj)->origin for non-weakrefable objects
        self._ev_counter = 0

    # ---------- helpers ----------
    def _out(self):
        return pathlib.Path(getattr(self.collector, "out", "."))

    def _sanitize(self, obj):
        fn = getattr(self.collector, "_sanitize", None)
        return fn(obj) if callable(fn) else obj

    def _timeout(self):
        try:
            t = float(getattr(self.collector, "timeout", 30) or 30)
        except (TypeError, ValueError):
            t = 30.0
        remaining = getattr(self.collector, "runtime_deadline", None)
        if remaining is not None:
            t = min(t, remaining - time.monotonic())
        return max(0.01, min(t, 120.0))

    def _check_sid(self, sid):
        if not isinstance(sid, str) or not SNAP_ID_RE.fullmatch(sid) or sid not in self.snapshots:
            raise ValueError("unknown or invalid snapshot id")
        return sid

    # ---------- snapshot ----------
    async def __call__(self, trigger="initial_load", parent_snapshot_id=None, *, action_id=None):
        if parent_snapshot_id is not None:
            self._check_sid(parent_snapshot_id)
        kw = {}
        if action_id is not None:
            kw["action_id"] = action_id
        return await self.collector.snapshot(trigger, parent_snapshot_id, **kw)

    take_snapshot = __call__

    def register(self, snapshot):
        """Called by collector after sanitized snapshot is assembled, before it writes full JSON.
        Only mutation: element keys (if absent) and ai_input_ref."""
        sid = snapshot.get("snapshot_id")
        if not isinstance(sid, str) or not SNAP_ID_RE.fullmatch(sid):
            raise ValueError("invalid snapshot id")
        els = snapshot.get("elements") or []
        if els and not all(isinstance(e, dict) and e.get("element_key") for e in els):
            assign_element_keys(snapshot)
        ref = "ai_inputs/%s.json" % sid
        snapshot["ai_input_ref"] = ref
        budget = getattr(self.collector, "summary_budget", None)
        ai = build_ai_input(snapshot, budget if isinstance(budget, dict) else None)
        _write_json(self._out() / "ai_inputs" / ("%s.json" % sid), ai)
        self.ai_inputs[sid] = ai
        self.snapshots[sid] = snapshot
        self.private_links[sid] = {
            'url': self.collector.page.url,
            'links': copy.deepcopy(self.collector.last_links),
        }
        self.last_snapshot = snapshot
        return ai

    finalize = register

    def get_ai_input(self, snapshot_id=None):
        if snapshot_id is None:
            if self.last_snapshot is None:
                return None
            snapshot_id = self.last_snapshot["snapshot_id"]
        self._check_sid(snapshot_id)
        return copy.deepcopy(self.ai_inputs.get(snapshot_id))

    def get_element(self, key, snapshot_id=None):
        if snapshot_id is None:
            snap = self.last_snapshot
            if snap is None:
                return None
        else:
            snap = self.snapshots[self._check_sid(snapshot_id)]
        el = get_by_element_key(snap, key)
        return copy.deepcopy(el) if el is not None else None

    # ---------- request/event attribution ----------
    def on_request(self, request):
        origin = self.active_action_id
        try:
            self._origins[request] = origin
        except TypeError:
            self._origins_fallback[id(request)] = origin

    def request_meta(self, request):
        try:
            if request in self._origins:
                return {"origin_action_id": self._origins[request]}
        except TypeError:
            pass
        if id(request) in self._origins_fallback:
            return {"origin_action_id": self._origins_fallback[id(request)]}
        return None

    response_meta = request_meta

    def event_meta(self, kind, request=None):
        self._ev_counter += 1
        eid = "ev-%d" % self._ev_counter
        if request is not None:
            m = self.request_meta(request)
            if m is not None:
                return {"event_id": eid, "kind": kind, "action_id": m["origin_action_id"], "association": "request_start"}
            return {"event_id": eid, "kind": kind, "action_id": None, "association": "unknown_request_origin"}
        return {"event_id": eid, "kind": kind, "action_id": self.active_action_id, "association": "temporal"}

    # ---------- action ----------
    async def _capture(self, trigger, parent, action_id):
        return await asyncio.wait_for(self(trigger, parent, action_id=action_id), self._timeout())

    @contextlib.asynccontextmanager
    async def action(self, action_id=None, kind="click", target_key=None):
        if self._busy:
            raise RuntimeError("an action is already active")
        if action_id is None:
            action_id = uuid.uuid4().hex[:32]
        if not isinstance(action_id, str) or not ACTION_ID_RE.fullmatch(action_id):
            raise ValueError("invalid action_id")
        if action_id in self._used_ids:
            raise ValueError("action_id already used in this run")
        if not isinstance(kind, str) or not ACTION_ID_RE.fullmatch(kind):
            raise ValueError("invalid kind")
        if target_key is not None:
            if self.last_snapshot is None or get_by_element_key(self.last_snapshot, target_key) is None:
                raise ValueError("unknown target_key")
        self._busy = True
        self._used_ids.add(action_id)
        rec = {"action_id": action_id, "kind": kind, "target_key": target_key,
               "before_snapshot_id": None, "after_snapshot_id": None, "diff": None,
               "status": "completed", "operator_error": None, "capture_error": None,
               "started_monotonic": time.monotonic(), "duration_s": None,
               "association": "temporal", "event_ids": [], "resource_ids": [],
               "before_ai_input_ref": None, "after_ai_input_ref": None}
        op_exc = None
        cap_exc = None
        before = None
        try:
            parent = self.last_snapshot["snapshot_id"] if self.last_snapshot else None
            before = await self._capture("before_action", parent, None)
            if isinstance(before, dict):
                rec["before_snapshot_id"] = before.get("snapshot_id")
                rec["before_ai_input_ref"] = before.get("ai_input_ref")
            if target_key is not None and get_by_element_key(before,target_key) is None:
                raise ValueError('target is absent from before snapshot')
            self.active_action_id = action_id
            try:
                self.collector.current_action_id = action_id
            except Exception:
                pass
            t0 = time.monotonic()
            try:
                yield rec
            except asyncio.CancelledError as e:
                op_exc = e
                rec["status"] = "cancelled"
                rec["operator_error"] = {"type": "CancelledError", "message": ""}
            except BaseException as e:
                op_exc = e
                rec["status"] = "failed"
                rec["operator_error"] = _err(e, self._sanitize)
            rec["duration_s"] = round(time.monotonic() - t0, 4)
            try:
                after = await self._capture("after_action", rec["before_snapshot_id"], action_id)
                if isinstance(after, dict):
                    rec["after_snapshot_id"] = after.get("snapshot_id")
                    rec["after_ai_input_ref"] = after.get("ai_input_ref")
                    for ev in after.get("events") or []:
                        if isinstance(ev, dict) and ev.get("action_id") == action_id and ev.get("event_id"):
                            rec["event_ids"].append(ev["event_id"])
                    for r in after.get("resources") or []:
                        if isinstance(r, dict) and r.get("origin_action_id") == action_id:
                            rid = r.get("resource_id") or r.get("event_id")
                            if rid:
                                rec["resource_ids"].append(rid)
                    if isinstance(before, dict):
                        rec["diff"] = diff_snapshots(before, after)
            except BaseException as e:
                cap_exc = e
                rec["capture_error"] = _err(e, self._sanitize) if not isinstance(e, asyncio.TimeoutError) else {"type": "timeout", "message": "after snapshot timed out"}
                if op_exc is None:
                    rec["status"] = "capture_failed"
        except BaseException as e:
            if before is None and rec["before_snapshot_id"] is None and cap_exc is None and op_exc is None:
                cap_exc = e
                rec["status"] = "capture_failed"
                rec["capture_error"] = _err(e, self._sanitize)
            elif op_exc is None and cap_exc is None:
                rec['status'] = 'failed'
                rec['operator_error'] = _err(e,self._sanitize)
            raise
        finally:
            self.active_action_id = None
            try:
                self.collector.current_action_id = None
            except Exception:
                pass
            self._busy = False
            try:
                safe = self._sanitize(copy.deepcopy(rec))
                safe['event_ids'] = list(dict.fromkeys(safe['event_ids']))
                safe['resource_ids'] = list(dict.fromkeys(safe['resource_ids']))
                _write_json(self._out() / "actions" / ("%s.json" % action_id), safe)
                self.records.append(safe)
                rec.clear()
                rec.update(copy.deepcopy(safe))
            except Exception as save_error:
                rec["persistence_error"] = _err(save_error, self._sanitize)
                self.records.append(self._sanitize(copy.deepcopy(rec)))
                if op_exc is None and cap_exc is None:
                    raise
        if op_exc is not None:
            raise op_exc
        if cap_exc is not None:
            raise cap_exc
