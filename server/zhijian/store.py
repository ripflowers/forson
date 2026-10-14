import math
from datetime import datetime, timezone
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .rules import check_question, publication_allowed


class Conflict(Exception):
    pass


class Invalid(Exception):
    pass


class Missing(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return str(uuid4())


class Store:
    def __init__(self, url):
        self.url = url

    def connection(self):
        return psycopg.connect(self.url, row_factory=dict_row, connect_timeout=3)

    def initialize(self):
        with self.connection() as c:
            c.execute("""
              CREATE TABLE IF NOT EXISTS zj_papers(id text PRIMARY KEY, data jsonb NOT NULL);
              CREATE TABLE IF NOT EXISTS zj_questions(id text PRIMARY KEY, paper_id text NOT NULL REFERENCES zj_papers(id), revision int NOT NULL, data jsonb NOT NULL);
              CREATE TABLE IF NOT EXISTS zj_question_versions(question_id text NOT NULL REFERENCES zj_questions(id), revision int NOT NULL, data jsonb NOT NULL, PRIMARY KEY(question_id,revision));
              CREATE TABLE IF NOT EXISTS zj_jobs(id text PRIMARY KEY, paper_id text NOT NULL REFERENCES zj_papers(id), question_id text REFERENCES zj_questions(id), state text NOT NULL, lease text, payload jsonb NOT NULL, data jsonb NOT NULL);
              CREATE TABLE IF NOT EXISTS zj_lessons(id text PRIMARY KEY, question_id text NOT NULL REFERENCES zj_questions(id), question_revision int NOT NULL, version int NOT NULL, data jsonb NOT NULL, UNIQUE(question_id,version));
              CREATE TABLE IF NOT EXISTS zj_events(id text PRIMARY KEY, question_id text NOT NULL REFERENCES zj_questions(id), data jsonb NOT NULL);
              CREATE TABLE IF NOT EXISTS zj_sessions(question_id text PRIMARY KEY REFERENCES zj_questions(id), session_revision int NOT NULL, data jsonb NOT NULL);
              CREATE TABLE IF NOT EXISTS zj_asks(id text PRIMARY KEY, question_id text NOT NULL REFERENCES zj_questions(id), data jsonb NOT NULL);
              CREATE INDEX IF NOT EXISTS zj_questions_paper ON zj_questions(paper_id);
              CREATE INDEX IF NOT EXISTS zj_jobs_state ON zj_jobs(state);
              CREATE INDEX IF NOT EXISTS zj_lessons_question ON zj_lessons(question_id,question_revision);
              CREATE INDEX IF NOT EXISTS zj_events_question ON zj_events(question_id);
              ALTER TABLE zj_questions ADD COLUMN IF NOT EXISTS current_lesson_job text;
              ALTER TABLE zj_questions ADD COLUMN IF NOT EXISTS current_lesson_lease text;
            """)

    def ready(self):
        try:
            with self.connection() as c:
                return c.execute("SELECT 1").fetchone() is not None
        except psycopg.Error:
            return False

    @staticmethod
    def _required(row):
        if row is None:
            raise Missing("对象不存在")
        return row["data"]

    def create_paper(self, title, pages, sample=False):
        data = {"id": uid(), "title": title, "createdAt": now(), "state": "extracting", "pages": pages,
                "questionCount": 0, "partCount": 0, "sample": sample}
        with self.connection() as c:
            c.execute("INSERT INTO zj_papers VALUES(%s,%s)", (data["id"], Jsonb(data)))
        return data

    def update_paper(self, paper_id, changes):
        with self.connection() as c:
            row = c.execute("SELECT data FROM zj_papers WHERE id=%s FOR UPDATE", (paper_id,)).fetchone()
            data = self._required(row)
            data.update(changes)
            c.execute("UPDATE zj_papers SET data=%s WHERE id=%s", (Jsonb(data), paper_id))
        return data

    def paper(self, paper_id):
        with self.connection() as c:
            return self._required(c.execute("SELECT data FROM zj_papers WHERE id=%s", (paper_id,)).fetchone())

    def papers(self):
        with self.connection() as c:
            return [r["data"] for r in c.execute("SELECT data FROM zj_papers ORDER BY data->>'createdAt' DESC").fetchall()]

    def questions(self, paper_id):
        with self.connection() as c:
            return [r["data"] for r in c.execute("SELECT data FROM zj_questions WHERE paper_id=%s ORDER BY (data->>'number')::int", (paper_id,)).fetchall()]

    def question(self, question_id, revision=None):
        with self.connection() as c:
            if revision is None:
                row = c.execute("SELECT data FROM zj_questions WHERE id=%s", (question_id,)).fetchone()
            else:
                row = c.execute("SELECT data FROM zj_question_versions WHERE question_id=%s AND revision=%s", (question_id, revision)).fetchone()
            return self._required(row)

    def save_extracted_questions(self, paper_id, extracted, job_id=None, lease=None):
        result = []
        with self.connection() as c:
            c.execute("SELECT id FROM zj_papers WHERE id=%s FOR UPDATE", (paper_id,))
            if job_id:
                job = c.execute("SELECT state,lease FROM zj_jobs WHERE id=%s FOR UPDATE", (job_id,)).fetchone()
                if not job or job["state"] != "running" or job["lease"] != lease:
                    raise Conflict("识别任务已取消或租约过期，晚回结果未发布")
            existing = c.execute("SELECT data FROM zj_questions WHERE paper_id=%s", (paper_id,)).fetchall()
            existing_numbers = {row["data"]["number"] for row in existing}
            numbers = [q["number"] for q in extracted]
            if len(numbers) != len(set(numbers)):
                raise Invalid("识别结果含重复题号，需要重新拆题")
            for raw in extracted:
                if raw["number"] in existing_numbers:
                    # Retry fills missing questions; it never rewrites corrected or confirmed questions.
                    continue
                data = {"id": uid(), "paperId": paper_id, "number": raw["number"], "revision": 1,
                        "stem": raw.get("stem", ""), "options": raw.get("options", []),
                        "figureDescription": raw.get("figureDescription", ""), "sourceRegions": raw.get("sourceRegions", []),
                        "missingFields": raw.get("missingFields", []), "parts": raw.get("parts", []),
                        "lessonState": None, "concepts": raw.get("concepts", [])}
                issues = check_question(data)
                data["missingFields"] = list(dict.fromkeys(issues))
                data["state"] = "needs_completion" if issues else "needs_confirmation"
                c.execute("INSERT INTO zj_questions(id,paper_id,revision,data) VALUES(%s,%s,%s,%s)", (data["id"], paper_id, 1, Jsonb(data)))
                c.execute("INSERT INTO zj_question_versions VALUES(%s,%s,%s)", (data["id"], 1, Jsonb(data)))
                result.append(data)
            row = c.execute("SELECT data FROM zj_papers WHERE id=%s", (paper_id,)).fetchone()
            data = self._required(row)
            all_questions = [row["data"] for row in existing] + result
            data.update(state="needs_confirmation", questionCount=len(all_questions), partCount=sum(len(q["parts"]) for q in all_questions))
            c.execute("UPDATE zj_papers SET data=%s WHERE id=%s", (Jsonb(data), paper_id))
        return sorted(all_questions, key=lambda q: q["number"])

    def update_question(self, question_id, expected_revision, patch):
        with self.connection() as c:
            data = self._required(c.execute("SELECT data FROM zj_questions WHERE id=%s FOR UPDATE", (question_id,)).fetchone())
            if data["revision"] != expected_revision:
                raise Conflict("题面已被修改，请重新加载；您的校对草稿应保留")
            if "sourceRegions" in patch:
                pages = self._required(c.execute("SELECT data FROM zj_papers WHERE id=%s", (data["paperId"],)).fetchone())["pages"]
                allowed_pages = {p["index"] for p in pages}
                for region in patch["sourceRegions"]:
                    values = [region.get(key) for key in ("x", "y", "width", "height")]
                    if type(region.get("pageIndex")) is not int or region["pageIndex"] not in allowed_pages or any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
                        raise Invalid("原图区域必须引用此试卷的实际页，坐标为有限数")
                    x, y, width, height = values
                    if not 0 <= x < 1 or not 0 <= y < 1 or not 0 < width <= 1 or not 0 < height <= 1 or x + width > 1 + 1e-9 or y + height > 1 + 1e-9:
                        raise Invalid("原图区域须位于页内，位置与宽高使用0到1坐标")
            for key in ("stem", "options", "figureDescription", "missingFields", "parts", "sourceRegions"):
                if key in patch:
                    data[key] = patch[key]
            issues = check_question(data)
            if patch.get("confirm") and issues:
                raise Invalid("题面缺项，无法确认：" + "；".join(issues))
            data["revision"] += 1
            data["state"] = "confirmed" if patch.get("confirm") else ("needs_completion" if issues else "needs_confirmation")
            data["lessonState"] = "stale" if c.execute("SELECT 1 FROM zj_lessons WHERE question_id=%s", (question_id,)).fetchone() else None
            c.execute("UPDATE zj_questions SET revision=%s,data=%s,current_lesson_job=NULL,current_lesson_lease=NULL WHERE id=%s", (data["revision"], Jsonb(data), question_id))
            c.execute("INSERT INTO zj_question_versions VALUES(%s,%s,%s)", (question_id, data["revision"], Jsonb(data)))
            c.execute("UPDATE zj_lessons SET data=jsonb_set(data,'{status}','\"stale\"') WHERE question_id=%s", (question_id,))
            c.execute("UPDATE zj_jobs SET state='cancel_requested',data=jsonb_set(data,'{state}','\"cancel_requested\"') WHERE question_id=%s AND state IN ('queued','running')", (question_id,))
        return data

    def confirm_all(self, paper_id):
        for question in self.questions(paper_id):
            if question["state"] != "confirmed" and not check_question(question):
                try:
                    self.update_question(question["id"], question["revision"], {"confirm": True})
                except Conflict:
                    pass
        return self.questions(paper_id)

    def create_job(self, paper_id, question_id, kind, payload):
        with self.connection() as c:
            c.execute("SELECT id FROM zj_papers WHERE id=%s FOR UPDATE", (paper_id,))
            existing = c.execute("SELECT data FROM zj_jobs WHERE paper_id=%s AND question_id IS NOT DISTINCT FROM %s AND data->>'type'=%s AND payload=%s AND state IN ('queued','running') ORDER BY data->>'createdAt' DESC LIMIT 1", (paper_id, question_id, kind, Jsonb(payload))).fetchone()
            if existing:
                return existing["data"]
            data = {"id": uid(), "paperId": paper_id, "questionId": question_id, "type": kind, "state": "queued",
                    "stage": "waiting", "completedUnits": 0, "totalUnits": payload.get("total", 1), "error": None, "createdAt": now()}
            c.execute("INSERT INTO zj_jobs VALUES(%s,%s,%s,'queued',NULL,%s,%s)", (data["id"], paper_id, question_id, Jsonb(payload), Jsonb(data)))
        return data

    def job(self, job_id, internal=False):
        with self.connection() as c:
            row = c.execute("SELECT data,payload,lease FROM zj_jobs WHERE id=%s", (job_id,)).fetchone()
            data = self._required(row)
            return {**data, "payload": row["payload"], "lease": row["lease"]} if internal else data

    def claim_job(self):
        with self.connection() as c:
            row = c.execute("SELECT * FROM zj_jobs WHERE state='queued' ORDER BY data->>'createdAt' FOR UPDATE SKIP LOCKED LIMIT 1").fetchone()
            if row is None:
                return None
            lease = uid()
            data = {**row["data"], "state": "running", "stage": "starting"}
            c.execute("UPDATE zj_jobs SET state='running',lease=%s,data=%s WHERE id=%s", (lease, Jsonb(data), row["id"]))
        return {**data, "lease": lease, "payload": row["payload"]}

    def recover_jobs(self):
        with self.connection() as c:
            c.execute("UPDATE zj_jobs SET state='queued',lease=NULL,data=jsonb_set(jsonb_set(data,'{state}','\"queued\"'),'{stage}','\"recovered\"') WHERE state='running'")
            c.execute("UPDATE zj_jobs SET state='cancelled',data=jsonb_set(data,'{state}','\"cancelled\"') WHERE state='cancel_requested'")

    def update_job(self, job_id, lease, **changes):
        with self.connection() as c:
            row = c.execute("SELECT data,lease,state FROM zj_jobs WHERE id=%s FOR UPDATE", (job_id,)).fetchone()
            data = self._required(row)
            if row["lease"] != lease:
                return False
            if row["state"] == "cancel_requested" and changes.get("state") not in (None, "cancelled"):
                changes.update(state="cancelled", stage="cancelled", error=None)
            data.update(changes)
            c.execute("UPDATE zj_jobs SET state=%s,data=%s WHERE id=%s", (data["state"], Jsonb(data), job_id))
        return True

    def cancel_job(self, job_id):
        with self.connection() as c:
            row = c.execute("SELECT data,state FROM zj_jobs WHERE id=%s FOR UPDATE", (job_id,)).fetchone()
            data = self._required(row)
            if row["state"] in {"queued", "running"}:
                data["state"] = "cancelled" if row["state"] == "queued" else "cancel_requested"
                data["stage"] = data["state"]
                c.execute("UPDATE zj_jobs SET state=%s,data=%s WHERE id=%s", (data["state"], Jsonb(data), job_id))
        return data

    def begin_lesson(self, question_id, revision, job_id, lease):
        with self.connection() as c:
            q = c.execute("SELECT revision FROM zj_questions WHERE id=%s FOR UPDATE", (question_id,)).fetchone()
            job = c.execute("SELECT state,lease FROM zj_jobs WHERE id=%s FOR UPDATE", (job_id,)).fetchone()
            if not q or not job or not publication_allowed(question_revision=q["revision"], generated_revision=revision, job_state=job["state"], lease_matches=job["lease"] == lease):
                return False
            c.execute("UPDATE zj_questions SET current_lesson_job=%s,current_lesson_lease=%s,data=jsonb_set(data,'{lessonState}','\"checking\"') WHERE id=%s", (job_id, lease, question_id))
        return True

    def set_lesson_state(self, question_id, revision, state, job_id=None, lease=None):
        with self.connection() as c:
            c.execute("UPDATE zj_questions SET data=jsonb_set(data,'{lessonState}',%s) WHERE id=%s AND revision=%s AND (%s::text IS NULL OR (current_lesson_job=%s AND current_lesson_lease=%s))", (Jsonb(state), question_id, revision, job_id, job_id, lease))

    def publish_lesson(self, question_id, revision, job_id, lease, lesson):
        with self.connection() as c:
            q = c.execute("SELECT revision,data,current_lesson_job,current_lesson_lease FROM zj_questions WHERE id=%s FOR UPDATE", (question_id,)).fetchone()
            job = c.execute("SELECT state,lease FROM zj_jobs WHERE id=%s FOR UPDATE", (job_id,)).fetchone()
            if not q or not job or q["current_lesson_job"] != job_id or q["current_lesson_lease"] != lease or not publication_allowed(question_revision=q["revision"], generated_revision=revision, job_state=job["state"], lease_matches=job["lease"] == lease):
                return False
            version = c.execute("SELECT COALESCE(MAX(version),0)+1 AS v FROM zj_lessons WHERE question_id=%s", (question_id,)).fetchone()["v"]
            data = {**lesson, "id": uid(), "questionId": question_id, "questionRevision": revision,
                    "lessonVersion": version, "createdAt": now()}
            c.execute("INSERT INTO zj_lessons VALUES(%s,%s,%s,%s,%s)", (data["id"], question_id, revision, version, Jsonb(data)))
            c.execute("UPDATE zj_questions SET data=jsonb_set(data,'{lessonState}',%s) WHERE id=%s", (Jsonb(data["status"]), question_id))
        return data

    def lesson(self, question_id, version=None):
        q = self.question(question_id)
        with self.connection() as c:
            if version is None:
                row = c.execute("SELECT data FROM zj_lessons WHERE question_id=%s ORDER BY version DESC LIMIT 1", (question_id,)).fetchone()
            else:
                row = c.execute("SELECT data FROM zj_lessons WHERE question_id=%s AND version=%s", (question_id, version)).fetchone()
            if not row:
                return None
            data = row["data"]
            if data["questionRevision"] != q["revision"] or q["state"] != "confirmed":
                data = {**data, "status": "stale"}
            return data

    def coverage(self, paper_id):
        with self.connection() as c:
            questions = [row["data"] for row in c.execute("SELECT data FROM zj_questions WHERE paper_id=%s ORDER BY (data->>'number')::int", (paper_id,)).fetchall()]
            lessons = {row["question_id"]: row["data"] for row in c.execute("SELECT DISTINCT ON(l.question_id) l.question_id,l.data FROM zj_lessons l JOIN zj_questions q ON q.id=l.question_id WHERE q.paper_id=%s ORDER BY l.question_id,l.version DESC", (paper_id,)).fetchall()}
        ready_q, ready_p, confirmed, blocked = 0, 0, 0, 0
        details = []
        for q in questions:
            lesson = lessons.get(q["id"])
            valid = lesson and lesson["status"] == "ready" and lesson["questionRevision"] == q["revision"] and q["state"] == "confirmed"
            ready_ids = set(lesson["coveredPartIds"]) if valid else set()
            ready_q += int(bool(valid) and ready_ids == {p["id"] for p in q["parts"]})
            ready_p += len(ready_ids)
            confirmed += int(q["state"] == "confirmed")
            if q["state"] == "needs_completion":
                blocked += len(q["parts"])
            details.append({"number": q["number"], "questionId": q["id"], "revision": q["revision"],
                            "parts": [{"partId": p["id"], "status": "ready" if p["id"] in ready_ids else ("blocked" if q["state"] == "needs_completion" else ("not_generated" if q["lessonState"] == "ready" else q["lessonState"] or "not_generated")),
                                       "issues": q["missingFields"] if q["state"] == "needs_completion" else (lesson.get("checks", {}).get("issues", []) if lesson else [])} for p in q["parts"]]})
        return {"coverage": {"questionCount": len(questions), "partCount": sum(len(q["parts"]) for q in questions),
                             "confirmedQuestions": confirmed, "readyQuestions": ready_q, "readyParts": ready_p, "blockedParts": blocked}, "questions": details}

    def add_event(self, payload):
        q = self.question(payload["questionId"], payload["questionRevision"])
        if payload.get("partId") is not None and payload["partId"] not in {p["id"] for p in q["parts"]}:
            raise Invalid("记录引用的小问不属于此题面版本")
        if payload.get("lessonVersion") is not None:
            lesson = self.lesson(q["id"], payload["lessonVersion"])
            if not lesson or lesson["questionRevision"] != payload["questionRevision"]:
                raise Invalid("学习记录引用的教案版本无效")
        if payload["kind"] == "observation" and payload["authorKind"] != "system-observation":
            raise Invalid("自动观察必须标记为系统观察")
        data = {**payload, "id": uid(), "createdAt": now()}
        with self.connection() as c:
            c.execute("INSERT INTO zj_events VALUES(%s,%s,%s)", (data["id"], q["id"], Jsonb(data)))
        return data

    def events(self, paper_id=None):
        with self.connection() as c:
            if paper_id:
                rows = c.execute("SELECT e.data FROM zj_events e JOIN zj_questions q ON q.id=e.question_id WHERE q.paper_id=%s ORDER BY e.data->>'createdAt' DESC", (paper_id,)).fetchall()
            else:
                rows = c.execute("SELECT data FROM zj_events ORDER BY data->>'createdAt' DESC").fetchall()
            return [r["data"] for r in rows]

    def session(self, question_id):
        self.question(question_id)
        with self.connection() as c:
            row = c.execute("SELECT data FROM zj_sessions WHERE question_id=%s", (question_id,)).fetchone()
            return row["data"] if row else None

    def save_session(self, question_id, expected_revision, payload):
        with self.connection() as c:
            q = self._required(c.execute("SELECT data FROM zj_questions WHERE id=%s FOR UPDATE", (question_id,)).fetchone())
            if payload["questionRevision"] != q["revision"]:
                raise Conflict("题面已有新版本，旧课堂现场保留但不能覆盖当前课堂")
            version = payload.get("lessonVersion")
            lesson = c.execute("SELECT data FROM zj_lessons WHERE question_id=%s ORDER BY version DESC LIMIT 1", (question_id,)).fetchone()
            if lesson and lesson["data"]["lessonVersion"] != version:
                raise Conflict("本题已有新教案版本，旧窗口草稿不能覆盖当前课堂现场")
            if not lesson or lesson["data"]["questionRevision"] != q["revision"] or lesson["data"]["status"] != "ready":
                raise Invalid("只能保存当前就绪课程的现场")
            if payload["partId"] not in {p["id"] for p in q["parts"]}:
                raise Invalid("课堂小问无效")
            row = c.execute("SELECT session_revision FROM zj_sessions WHERE question_id=%s FOR UPDATE", (question_id,)).fetchone()
            actual = row["session_revision"] if row else 0
            if actual != expected_revision:
                raise Conflict("另一窗口已保存新现场；请保留本窗口草稿后重新加载")
            data = {**payload, "questionId": question_id, "sessionRevision": actual + 1, "updatedAt": now()}
            c.execute("INSERT INTO zj_sessions VALUES(%s,%s,%s) ON CONFLICT(question_id) DO UPDATE SET session_revision=EXCLUDED.session_revision,data=EXCLUDED.data", (question_id, actual + 1, Jsonb(data)))
        return data

    def save_ask(self, question_id, payload):
        data = {**payload, "id": uid(), "questionId": question_id, "createdAt": now()}
        with self.connection() as c:
            c.execute("INSERT INTO zj_asks VALUES(%s,%s,%s)", (data["id"], question_id, Jsonb(data)))
        return data

    def asks(self, question_id):
        self.question(question_id)
        with self.connection() as c:
            return [row["data"] for row in c.execute("SELECT data FROM zj_asks WHERE question_id=%s ORDER BY data->>'createdAt'", (question_id,)).fetchall()]
