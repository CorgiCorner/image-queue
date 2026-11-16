#!/usr/bin/env python3
"""Exclusive image-job reservations shared by scheduled Codex chats."""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import sys
import tempfile
import time
import uuid


def utcnow():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@contextmanager
def queue_lock(root, timeout):
    lock = root / ".queue.lock"
    deadline = time.monotonic() + timeout
    while True:
        try:
            lock.mkdir()
            break
        except FileExistsError:
            if time.monotonic() >= deadline:
                raise ValueError("queue lock is busy; never remove another process's lock")
            time.sleep(0.05)
    try:
        yield
    finally:
        lock.rmdir()


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".partial", dir=path.parent)
    try:
        if path.exists():
            os.fchmod(fd, stat.S_IMODE(path.stat().st_mode))
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def blocks(data):
    headings = list(re.finditer(rb"^## (IMG-[A-Za-z0-9-]+)\r?$", data, re.M))
    result = []
    seen = set()
    for index, heading in enumerate(headings):
        end = headings[index + 1].start() if index + 1 < len(headings) else len(data)
        body = data[heading.start():end]
        statuses = list(re.finditer(rb"^- Status: ([^\r\n]+)", body, re.M))
        request_id = heading[1].decode()
        if request_id in seen or len(statuses) != 1:
            raise ValueError(f"duplicate ID or invalid Status field: {request_id}")
        seen.add(request_id)
        status = statuses[0]
        fingerprint = hashlib.sha256((body[:status.start()] + body[status.end():]).rstrip(b"\r\n")).hexdigest()
        result.append(dict(id=request_id, status=status[1].decode(), body=body,
                           start=heading.start() + status.start(),
                           end=heading.start() + status.end(), fingerprint=fingerprint))
    return result


def claim_path(root, request_id):
    return root / "out" / ".claims" / (request_id + ".json")


def read_claim(root, request_id):
    path = claim_path(root, request_id)
    return json.loads(path.read_text()) if path.exists() else None


def save_claim(root, claim):
    atomic_write(claim_path(root, claim["id"]),
                 (json.dumps(claim, indent=2) + "\n").encode())


def set_status(root, data, block, status):
    updated = data[:block["start"]] + ("- Status: " + status).encode() + data[block["end"]:]
    atomic_write(root / "images-todo.md", updated)


def owned(root, args, entries):
    block = next((b for b in entries if b["id"] == args.id), None)
    claim = read_claim(root, args.id)
    if not block or not claim or claim["worker"] != args.worker or claim["token"] != args.token:
        raise ValueError("reservation does not belong to this worker/token")
    if block["status"] != "in-progress" or claim["state"] != "reserved":
        raise ValueError("job is no longer reserved and in-progress")
    if block["fingerprint"] != claim["request_sha256"] and args.command != "finish":
        raise ValueError("request changed after reservation; do not generate or publish stale work")
    return block, claim


def output_path(root, block):
    match = re.search(rb"^- Save to: ([^\r\n]+)", block["body"], re.M)
    if not match:
        raise ValueError("request has no Save to path")
    path = Path(match[1].decode())
    parent = (root / "out" / block["id"]).resolve()
    if not parent.is_relative_to((root / "out").resolve()) or not path.is_absolute() or path.resolve().parent != parent or path.suffix != ".png":
        raise ValueError("Save to must be a PNG directly inside out/<ID>/")
    return path


def validate_png(path, block):
    size = re.search(rb"^- Size: (\d+)\s*[x\xc3\x97]+\s*(\d+) PNG", block["body"], re.M)
    with path.open("rb") as source:
        header = source.read(33)
    if not size or len(header) < 33 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError("invalid PNG or missing exact Size field")
    if struct.unpack(">II", header[16:24]) != (int(size[1]), int(size[2])):
        raise ValueError("PNG dimensions do not match the request")
    # This is a delivery guard, not visual/alpha QA; the generator must do both.


def generation_payload(root, block):
    """An additive courier envelope. Never rewrite the reserved queue entry."""
    text = block["body"].decode().replace("\r\n", "\n")
    prompt = re.search(r"^- Prompt: (.*(?:\n(?!- |## ).*)*)", text, re.M)
    size = re.search(r"^- Size: (\d+)\s*[x×]\s*(\d+) PNG$", text, re.M)
    references = re.search(r"^- References:[ \t]*([^\n]*)", text, re.M)
    paths = []
    error = None
    if references and references[1].strip() != "none":
        entries = [entry.strip() for entry in references[1].split(",")]
        if not all(entries) or len(entries) > 10:
            error = "References must contain between one and ten image files"
        else:
            for entry in entries:
                file = Path(entry)
                if not file.is_absolute():
                    file = root.parent / file
                file = file.resolve()
                if not file.is_file():
                    error = "A required reference file is missing; block this request"
                else:
                    with file.open("rb") as source:
                        header = source.read(12)
                    if not (header.startswith(b"\x89PNG\r\n\x1a\n") or header.startswith(b"\xff\xd8\xff") or
                            header[:4] == b"RIFF" and header[8:12] == b"WEBP"):
                        error = "A required reference is not a supported PNG, JPEG or WebP image"
                paths.append(str(file))
    if not prompt or not prompt[1].strip() or not size:
        error = "The request needs an exact prompt and PNG dimensions"
    requested_prompt = prompt[1].rstrip("\n") if prompt else ""
    arguments = {
        "prompt": requested_prompt,
        "transparent_background": bool(re.search(r"^- Background: transparent$", text, re.M)),
    }
    if paths:
        arguments["referenced_image_paths"] = paths
    return {
        "version": 1,
        "ready": error is None,
        "error": error,
        "mode": "edit-with-reference" if paths or references and references[1].strip() != "none" else "new-image",
        "width": int(size[1]) if size else None,
        "height": int(size[2]) if size else None,
        "referenceCount": len(paths),
        "referencePaths": paths,
        "toolArguments": arguments,
        "instruction": "Forward toolArguments literally. Do not summarize, translate, improve or replace the prompt. Preserve reference order. If ready=false or any attachment is rejected, finish blocked; never fall back to text-only generation.",
    }


def validate_receipt(root, block, receipt):
    expected = generation_payload(root, block)
    if not expected["ready"]:
        raise ValueError(expected["error"])
    arguments = expected["toolArguments"]
    if receipt.get("prompt") != arguments["prompt"]:
        raise ValueError("generator prompt differs from the reserved request")
    if receipt.get("referencePaths") != expected["referencePaths"]:
        raise ValueError("generator references differ from the reserved request or order")
    attachment = receipt.get("attachment")
    if expected["referenceCount"]:
        if not isinstance(attachment, dict):
            raise ValueError("reference attachment evidence is required")
        parameter, value = attachment.get("parameter"), attachment.get("value")
        if not ((parameter == "referenced_image_paths" and value == expected["referencePaths"]) or
                (parameter == "num_last_images_to_include" and type(value) is int and value == expected["referenceCount"])):
            raise ValueError("generator attachment does not include the required references")
    elif attachment is not None:
        raise ValueError("unexpected reference attachment on a new-image request")


def run(args):
    root = args.root.resolve()
    with queue_lock(root, args.lock_timeout):
        data = (root / "images-todo.md").read_bytes()
        entries = blocks(data)
        if args.command == "list":
            return [{"id": b["id"], "status": b["status"], "reservation": read_claim(root, b["id"])}
                    for b in entries if b["status"] in ("pending", "in-progress")]
        if args.command == "claim":
            # Resume this chat's reservation before acquiring another job.
            for block in entries:
                claim = read_claim(root, block["id"])
                if claim and claim["worker"] == args.worker and claim["state"] == "reserved" and block["status"] in ("pending", "in-progress"):
                    if block["fingerprint"] != claim["request_sha256"]:
                        raise ValueError("owned request changed; inspect the reservation before continuing")
                    if block["status"] == "pending":
                        set_status(root, data, block, "in-progress")
                    return {**claim, "already_owned": True, "request": block["body"].decode(),
                            "generation": generation_payload(root, block)}
            for block in entries:
                if block["status"] != "pending" or read_claim(root, block["id"]) is not None:
                    continue
                claim = dict(version=2, id=block["id"], worker=args.worker,
                             token=str(uuid.uuid4()), claimed_at_utc=utcnow(),
                             request_sha256=block["fingerprint"], state="reserved")
                # Durable ownership first: a crash before the Status write still
                # leaves the job exclusively reserved for this chat to resume.
                save_claim(root, claim)
                set_status(root, data, block, "in-progress")
                return {**claim, "already_owned": False, "request": block["body"].decode(),
                        "generation": generation_payload(root, block)}
            return {"job": None}
        block, claim = owned(root, args, entries)
        if args.command == "check":
            return {**claim, "generation": generation_payload(root, block)}
        if args.command == "publish":
            target = output_path(root, block)
            provenance = Path(str(target) + ".prompt.md")
            partial = Path(str(target) + ".partial")
            if target.exists() or provenance.exists() or partial.exists():
                raise ValueError("delivery already exists; inspect it and preserve originals")
            validate_png(args.source, block)
            if not args.prompt_source.read_text().strip():
                raise ValueError("provenance file is empty")
            receipt = None
            if claim.get("version", 1) >= 2 or args.generation_receipt:
                if not args.generation_receipt:
                    raise ValueError("publish requires --generation-receipt from the actual tool call")
                receipt = json.loads(args.generation_receipt.read_text())
                if not isinstance(receipt, dict):
                    raise ValueError("generation receipt must be an object")
                validate_receipt(root, block, receipt)
            target.parent.mkdir(parents=True, exist_ok=True)
            # Ownership and the request fingerprint stay locked through delivery.
            with args.source.open("rb") as source, partial.open("xb") as output:
                shutil.copyfileobj(source, output)
                output.flush()
                os.fsync(output.fileno())
            atomic_write(provenance, args.prompt_source.read_bytes())
            if receipt is not None:
                atomic_write(Path(str(target) + ".generation.json"),
                             (json.dumps(receipt, ensure_ascii=False, indent=2) + "\n").encode())
            os.replace(partial, target)
            claim["published_at_utc"] = utcnow()
            save_claim(root, claim)
            return {"save_to": str(target), "reservation": claim}
        if args.status == "done":
            if block["fingerprint"] != claim["request_sha256"]:
                raise ValueError("request changed after reservation; cannot mark done")
            target = output_path(root, block)
            validate_png(target, block)
            if not Path(str(target) + ".prompt.md").is_file():
                raise ValueError("delivery provenance is missing")
            if claim.get("version", 1) >= 2:
                receipt = Path(str(target) + ".generation.json")
                if not receipt.is_file():
                    raise ValueError("validated generation receipt is missing; publish through the helper")
                recorded = json.loads(receipt.read_text())
                if not isinstance(recorded, dict):
                    raise ValueError("generation receipt must be an object")
                validate_receipt(root, block, recorded)
            status = "done"
        else:
            if not args.reason or "\n" in args.reason or "\r" in args.reason:
                raise ValueError("blocked status needs a concise one-line reason")
            status = "blocked: " + args.reason
        set_status(root, data, block, status)
        claim.update(state=args.status, finished_at_utc=utcnow())
        save_claim(root, claim)
        return claim


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--lock-timeout", type=float, default=10)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list")
    claim = commands.add_parser("claim")
    claim.add_argument("--worker", required=True)
    for command in ("check", "publish", "finish"):
        sub = commands.add_parser(command)
        for field in ("worker", "id", "token"):
            sub.add_argument("--" + field, required=True)
        if command == "publish":
            sub.add_argument("--source", type=Path, required=True)
            sub.add_argument("--prompt-source", type=Path, required=True)
            sub.add_argument("--generation-receipt", type=Path)
        if command == "finish":
            sub.add_argument("--status", choices=("done", "blocked"), required=True)
            sub.add_argument("--reason")
    args = parser.parse_args()
    try:
        print(json.dumps(run(args), ensure_ascii=False))
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
