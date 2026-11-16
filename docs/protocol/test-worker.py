"""Run with python3 images-todo/test-worker.py; fixtures never touch the live queue."""

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib


SCRIPT = Path(__file__).with_name("worker.py")
REQUEST = Path(__file__).with_name("request.sh")


def png(width, height):
    def chunk(name, body):
        return struct.pack(">I", len(body)) + name + body + struct.pack(">I", zlib.crc32(name + body))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress((b"\0" + b"\xff\0\0\xff" * width) * height))
            + chunk(b"IEND", b""))


class Reservations(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.queue = self.root / "images-todo.md"
        self.queue.write_text("# Queue\n")
        shutil.copy2(REQUEST, self.root / "request.sh")

    def tearDown(self):
        self.temporary.cleanup()

    def add(self, request_id):
        self.queue.write_text(self.queue.read_text() +
                             f"\n## {request_id}\n- Status: pending\n- Save to: {self.root}/out/{request_id}/art.png\n"
                             "- Size: 2x3 PNG\n- Prompt: Keep this text.\n")

    def call(self, *arguments, success=True):
        result = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.root),
                                 "--lock-timeout", "0.5", *arguments], capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0)
        return result

    def credentials(self, claim, worker=None):
        return ["--worker", worker or claim["worker"], "--id", claim["id"], "--token", claim["token"]]

    def test_parallel_claims_are_distinct_and_only_status_changes(self):
        self.add("IMG-first")
        self.add("IMG-second")
        original = self.queue.read_text()
        with ThreadPoolExecutor(2) as pool:
            claims = list(pool.map(lambda worker: self.call("claim", "--worker", worker), ("chat-a", "chat-b")))
        self.assertEqual({c["id"] for c in claims}, {"IMG-first", "IMG-second"})
        self.assertEqual(self.queue.read_text(), original.replace("- Status: pending", "- Status: in-progress"))
        resumed = self.call("claim", "--worker", "chat-a")
        self.assertTrue(resumed["already_owned"])
        self.assertEqual(resumed["token"], claims[0]["token"])

    def test_claim_and_request_append_share_the_lock(self):
        self.add("IMG-first")
        claim = self.call("claim", "--worker", "chat-a")
        appended = subprocess.run(["bash", str(self.root / "request.sh"), "IMG-next", "next.png"],
                                  input="- Size: 2x3 PNG\n- Prompt: Next.\n", text=True, capture_output=True)
        self.assertEqual(appended.returncode, 0, appended.stderr)
        self.call("check", *self.credentials(claim))
        self.call("finish", *self.credentials(claim), "--status", "blocked", "--reason", "test fixture")
        self.assertIn("## IMG-next\n- Status: pending", self.queue.read_text())

    def test_concurrent_append_and_claim_preserve_both_requests(self):
        self.add("IMG-first")
        with ThreadPoolExecutor(2) as pool:
            claiming = pool.submit(self.call, "claim", "--worker", "chat-a")
            appending = pool.submit(subprocess.run,
                                    ["bash", str(self.root / "request.sh"), "IMG-next", "next.png"],
                                    input="- Size: 2x3 PNG\n- Prompt: Next.\n", text=True, capture_output=True)
            claim = claiming.result()
            result = appending.result()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(claim["id"], "IMG-first")
        self.assertIn("## IMG-first\n- Status: in-progress", self.queue.read_text())
        self.assertIn("## IMG-next\n- Status: pending", self.queue.read_text())
        self.call("check", *self.credentials(claim))

    def test_terminal_and_legacy_in_progress_jobs_are_not_claimed(self):
        for request_id in ("IMG-done", "IMG-blocked", "IMG-legacy", "IMG-pending"):
            self.add(request_id)
        data = self.queue.read_text()
        for request_id, status in (("IMG-done", "done"), ("IMG-blocked", "blocked: fixture"),
                                   ("IMG-legacy", "in-progress")):
            data = data.replace(f"## {request_id}\n- Status: pending", f"## {request_id}\n- Status: {status}")
        self.queue.write_text(data)
        self.assertEqual(self.call("claim", "--worker", "chat-a")["id"], "IMG-pending")
        self.assertEqual(self.call("claim", "--worker", "chat-b"), {"job": None})

    def test_non_owner_and_changed_request_cannot_publish_or_finish_done(self):
        self.add("IMG-first")
        claim = self.call("claim", "--worker", "chat-a")
        self.call("check", *self.credentials(claim, "chat-b"), success=False)
        self.call("finish", *self.credentials(claim, "chat-b"), "--status", "blocked", "--reason", "no", success=False)
        self.queue.write_text(self.queue.read_text().replace("Keep this text.", "Changed request."))
        self.call("check", *self.credentials(claim), success=False)
        self.call("finish", *self.credentials(claim), "--status", "done", success=False)
        self.assertIn("- Status: in-progress", self.queue.read_text())

    def test_reservation_survives_crash_before_status_write(self):
        self.add("IMG-first")
        claim = self.call("claim", "--worker", "chat-a")
        self.queue.write_text(self.queue.read_text().replace("in-progress", "pending"))
        self.assertEqual(self.call("claim", "--worker", "chat-b"), {"job": None})
        self.assertEqual(self.call("claim", "--worker", "chat-a")["token"], claim["token"])
        self.assertIn("- Status: in-progress", self.queue.read_text())

    def test_publish_checks_size_owner_and_preserves_originals(self):
        self.add("IMG-first")
        claim = self.call("claim", "--worker", "chat-a")
        source = self.root / "source.png"
        prompt = self.root / "prompt.md"
        prompt.write_text("Tool: image_gen.imagegen\nModel: not exposed\nPrompt: fixture\nUTC: fixture\n")
        receipt = self.root / "receipt.json"
        receipt.write_text(json.dumps({"prompt": "Keep this text.", "referencePaths": [], "attachment": None}))
        args = ["publish", *self.credentials(claim), "--source", str(source), "--prompt-source", str(prompt), "--generation-receipt", str(receipt)]
        source.write_bytes(png(3, 2))
        self.call(*args, success=False)
        source.write_bytes(png(2, 3))
        self.call("publish", *self.credentials(claim, "chat-b"), "--source", str(source), "--prompt-source", str(prompt), success=False)
        delivered = self.call(*args)
        target = Path(delivered["save_to"])
        self.assertEqual(target.read_bytes(), source.read_bytes())
        self.assertTrue(source.exists())
        self.assertFalse(Path(str(target) + ".partial").exists())
        self.call(*args, success=False)
        self.call("finish", *self.credentials(claim), "--status", "done")
        self.assertIn("- Status: done", self.queue.read_text())
        self.assertEqual(self.call("claim", "--worker", "chat-b"), {"job": None})

    def test_courier_preserves_multiline_prompt_and_reference_order(self):
        self.add("IMG-first")
        first, second = self.root / "z.png", self.root / "a.png"
        first.write_bytes(png(2, 3))
        second.write_bytes(png(2, 3))
        self.queue.write_text(self.queue.read_text().replace("- Prompt: Keep this text.",
            f"- References: {first}, {second}\n- Prompt: Change only the first reference.\nKeep REF-7391, punctuation: żółć!"))
        before = self.queue.read_bytes()
        claim = self.call("claim", "--worker", "chat-a")
        payload = claim["generation"]
        self.assertTrue(payload["ready"])
        self.assertEqual(payload["mode"], "edit-with-reference")
        self.assertEqual(payload["toolArguments"]["prompt"], "Change only the first reference.\nKeep REF-7391, punctuation: żółć!")
        self.assertEqual(payload["toolArguments"]["referenced_image_paths"], [str(first), str(second)])
        self.assertEqual((payload["width"], payload["height"]), (2, 3))
        self.assertEqual(self.queue.read_bytes(), before.replace(b"Status: pending", b"Status: in-progress"))
        self.assertEqual(self.call("check", *self.credentials(claim))["generation"], payload)

    def test_missing_reference_fails_closed_but_keeps_claim_available_to_block(self):
        self.add("IMG-first")
        self.queue.write_text(self.queue.read_text().replace("- Prompt:", "- References: missing.png\n- Prompt:"))
        claim = self.call("claim", "--worker", "chat-a")
        self.assertFalse(claim["generation"]["ready"])
        self.assertIn("missing", claim["generation"]["error"])
        self.call("finish", *self.credentials(claim), "--status", "blocked", "--reason", "Required reference missing")

    def test_publish_rejects_changed_prompt_missing_attachment_and_reordered_references(self):
        self.add("IMG-first")
        refs = [self.root / "first.png", self.root / "second.png"]
        for ref in refs:
            ref.write_bytes(png(2, 3))
        self.queue.write_text(self.queue.read_text().replace("- Prompt:", f"- References: {refs[0]}, {refs[1]}\n- Prompt:"))
        claim = self.call("claim", "--worker", "chat-a")
        source, prompt, receipt = self.root / "source.png", self.root / "prompt.md", self.root / "receipt.json"
        source.write_bytes(png(2, 3))
        prompt.write_text("actual tool provenance")
        base = ["publish", *self.credentials(claim), "--source", str(source), "--prompt-source", str(prompt)]
        self.call(*base, success=False)
        valid = {"prompt": "Keep this text.", "referencePaths": [str(ref) for ref in refs],
                 "attachment": {"parameter": "referenced_image_paths", "value": [str(ref) for ref in refs]}}
        invalid = [dict(valid, prompt="Improved prompt"), dict(valid, attachment=None),
                   dict(valid, referencePaths=list(reversed(valid["referencePaths"]))),
                   dict(valid, attachment={"parameter": "num_last_images_to_include", "value": 1}),
                   dict(valid, attachment={"parameter": "num_last_images_to_include", "value": True})]
        for evidence in invalid:
            receipt.write_text(json.dumps(evidence))
            self.call(*base, "--generation-receipt", str(receipt), success=False)
            self.assertFalse((self.root / "out/IMG-first/art.png").exists())
        receipt.write_text(json.dumps(valid))
        result = self.call(*base, "--generation-receipt", str(receipt))
        self.assertEqual(json.loads(Path(result["save_to"] + ".generation.json").read_text()), valid)

    def test_legacy_reservation_can_finish_without_new_receipt(self):
        self.add("IMG-first")
        claim = self.call("claim", "--worker", "chat-a")
        saved = self.root / "out/.claims/IMG-first.json"
        previous = json.loads(saved.read_text())
        previous["version"] = 1
        saved.write_text(json.dumps(previous))
        source, prompt = self.root / "source.png", self.root / "prompt.md"
        source.write_bytes(png(2, 3))
        prompt.write_text("legacy provenance")
        self.call("publish", *self.credentials(claim), "--source", str(source), "--prompt-source", str(prompt))
        self.call("finish", *self.credentials(claim), "--status", "done")

    def test_invalid_reference_file_and_excessive_count_fail_closed(self):
        self.add("IMG-first")
        file = self.root / "not-an-image.png"
        file.write_text("not an image")
        self.queue.write_text(self.queue.read_text().replace("- Prompt:", f"- References: {file}\n- Prompt:"))
        claim = self.call("claim", "--worker", "chat-a")
        self.assertFalse(claim["generation"]["ready"])
        self.call("finish", *self.credentials(claim), "--status", "blocked", "--reason", "Unsupported attachment")
        self.add("IMG-second")
        self.queue.write_text(self.queue.read_text().replace("## IMG-second\n- Status: pending", "## IMG-second\n- References: " + ", ".join([str(file)] * 11) + "\n- Status: pending"))
        claim = self.call("claim", "--worker", "chat-a")
        self.assertFalse(claim["generation"]["ready"])
        self.assertIn("ten", claim["generation"]["error"])

    def test_new_claim_cannot_finish_a_delivery_without_a_receipt(self):
        self.add("IMG-first")
        claim = self.call("claim", "--worker", "chat-a")
        target = self.root / "out/IMG-first/art.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(png(2, 3))
        Path(str(target) + ".prompt.md").write_text("unvalidated provenance")
        result = self.call("finish", *self.credentials(claim), "--status", "done", success=False)
        self.assertIn("receipt is missing", result.stderr)
        self.assertIn("Status: in-progress", self.queue.read_text())

    def test_busy_lock_fails_closed_without_removing_it(self):
        self.add("IMG-first")
        original = self.queue.read_bytes()
        lock = self.root / ".queue.lock"
        lock.mkdir()
        self.call("claim", "--worker", "chat-a", success=False)
        self.assertTrue(lock.is_dir())
        self.assertEqual(self.queue.read_bytes(), original)
        # Avoid waiting ten seconds in the append regression test.
        script = self.root / "request.sh"
        script.write_text(script.read_text().replace("seq 1 100", "seq 1 1"))
        result = subprocess.run(["bash", str(script), "IMG-next", "next.png"],
                                input="- Prompt: fixture\n", text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(lock.is_dir())
        self.assertEqual(self.queue.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
