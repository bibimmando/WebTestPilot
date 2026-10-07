import unittest

from src.preprocessing.webtestpilot import run_pipeline


START = "https://example.test/"


def sparse_crawl():
    return {
        "start_url": START,
        "pages": [{"url": START, "final_url": START, "status": 200, "content_type": "text/html"}],
        "endpoints": [{"method": "GET", "origin": "https://example.test", "url_pattern": "/", "parameter_schema": {}, "discovery_methods": ["seed"], "source_pages": []}],
        "forms": [],
        "dynamic_candidates": [],
        "metrics": {"visited_pages": 1},
    }


class PipelineTest(unittest.TestCase):
    def test_sparse_spa_uses_observer_once(self):
        calls = []

        def observer(data):
            calls.append(data)
            return {
                **data,
                "browser_observation": {"pages": 1},
                "dynamic_candidates": [{
                    "source_page": START, "selector": "#new-todo",
                    "label": "What needs to be done?", "action_hint": "user_input",
                }],
            }

        ranked, evidence = run_pipeline(sparse_crawl(), observer=observer)
        self.assertEqual(len(calls), 1)
        self.assertEqual(ranked["metrics"]["selected_candidates"], 1)
        self.assertEqual(ranked["pipeline"]["browser_pages"], 1)
        self.assertEqual(evidence["browser_observation"]["pages"], 1)

    def test_existing_candidates_skip_browser(self):
        data = sparse_crawl()
        data["dynamic_candidates"] = [{
            "source_page": START, "selector": "#search", "label": "Search",
            "action_hint": "user_input",
        }]

        def unexpected(_):
            self.fail("browser should not be used")

        ranked, _ = run_pipeline(data, observer=unexpected)
        self.assertEqual(ranked["pipeline"]["mode"], "static")

    def test_browser_failure_is_explicit(self):
        def failing(_):
            raise RuntimeError("unavailable")

        ranked, _ = run_pipeline(sparse_crawl(), observer=failing)
        self.assertEqual(ranked["metrics"]["selected_candidates"], 0)
        self.assertIn("unavailable", ranked["pipeline"]["warning"])


if __name__ == "__main__":
    unittest.main()
