"""Sequential campaign ledger, scoped to origin, requirements and permissions."""
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit


class CampaignState:
    def __init__(self, path, url, requirements, allow_writes):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = self.path.with_name(self.path.name + '.lock')
        self.handle = self.lock.open('x')  # Refuse concurrent readers/writers of this campaign.
        self.scope = hashlib.sha256(json.dumps([urlsplit(url)[:2], requirements, allow_writes],
                                               ensure_ascii=False).encode()).hexdigest()
        try:
            self.data = json.loads(self.path.read_text(encoding='utf-8')) if self.path.exists() else {
                'schema_version': 'campaign_state/1', 'scope': self.scope, 'checks': {}}
            if self.data.get('schema_version') != 'campaign_state/1' or self.data.get('scope') != self.scope:
                raise ValueError('campaign state scope mismatch; choose a different campaign file')
            if not isinstance(self.data.get('checks'), dict):
                raise ValueError('invalid campaign checks')
        except BaseException:
            self.close()
            raise

    def attach(self, runtime):
        runtime.campaign_state = self
        runtime.common_check_descriptions = dict(self.data['checks'])
        runtime.covered_common_checks = set(self.data['checks'])

    def save(self, runtime):
        self.data['checks'] = dict(runtime.common_check_descriptions)
        temporary = self.path.with_name(self.path.name + '.tmp')
        temporary.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(self.path)

    def close(self):
        self.handle.close()
        self.lock.unlink(missing_ok=True)
