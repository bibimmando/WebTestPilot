import hashlib
import json
from pathlib import Path
import unittest


class JudgmentSourceSyncTest(unittest.TestCase):
    def test_standalone_runtime_matches_canonical_judgment(self):
        root = Path(__file__).resolve().parents[3]
        manifest = json.loads((root / 'integration/judgment/source_manifest.json').read_text(encoding='utf-8'))
        for relative, digest in manifest['files'].items():
            with self.subTest(path=relative):
                for base in (root / 'src/ai_inspection/judgment', root / 'integration/judgment'):
                    self.assertEqual(hashlib.sha256((base / relative).read_bytes()).hexdigest(), digest)


if __name__ == '__main__':
    unittest.main()
