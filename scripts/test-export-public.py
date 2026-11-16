"""Exercise public export against disposable repositories, never the real index."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

EXPORT = Path(__file__).with_name("export-public.py")


class PublicExportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "repo"
        (self.root / "scripts").mkdir(parents=True)
        shutil.copyfile(EXPORT, self.root / "scripts/export-public.py")
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.destination = Path(self.temp.name) / "public"

    def tearDown(self):
        self.temp.cleanup()

    def track(self, name, contents="fixture"):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(contents)
        subprocess.run(["git", "add", "--", name], cwd=self.root, check=True)

    def export(self):
        return subprocess.run([sys.executable, str(self.root / "scripts/export-public.py"), str(self.destination)], capture_output=True, text=True)

    def test_excludes_private_documents_and_history(self):
        for name in ["README.md", ".env.example", "docs/internal/JOURNAL.md", "docs/handoff/HANDOFF.md", "TODO.md", "TODO-HANDOFF.md", "SESSION-HANDOFF.md"]:
            self.track(name)
        self.assertEqual(self.export().returncode, 0)
        self.assertTrue((self.destination / "README.md").exists())
        self.assertTrue((self.destination / ".env.example").exists())
        for name in ["docs/internal", "docs/handoff", "TODO.md", "TODO-HANDOFF.md", "SESSION-HANDOFF.md", ".git"]:
            self.assertFalse((self.destination / name).exists())
        self.assertNotEqual(self.export().returncode, 0)

    def test_rejects_runtime_and_credential_files_before_writing(self):
        for name in [".env.local", "config/.env.production", "storage/job.json", "projects/user-image.png", "work/output.png", "credentials/key", ".next/cache"]:
            with self.subTest(name=name):
                self.track(name)
                self.assertNotEqual(self.export().returncode, 0)
                self.assertFalse(self.destination.exists())
                subprocess.run(["git", "rm", "--cached", "--", name], cwd=self.root, check=True, capture_output=True)

    def test_rejects_symlinks(self):
        self.track("README.md")
        (self.root / "link").symlink_to("README.md")
        subprocess.run(["git", "add", "link"], cwd=self.root, check=True)
        self.assertNotEqual(self.export().returncode, 0)
        self.assertFalse(self.destination.exists())

    def test_checks_links_against_exported_files(self):
        self.track("README.md", "[Private](docs/internal/notes.md)")
        self.track("docs/internal/notes.md")
        self.assertNotEqual(self.export().returncode, 0)
        self.assertFalse(self.destination.exists())
        self.track("README.md", "[Guide](docs/user%20guide.md#start) [Site](https://example.com) [Section](#start)")
        self.track("docs/user guide.md", "# Start")
        self.assertEqual(self.export().returncode, 0)


if __name__ == "__main__":
    unittest.main()
