import json
from http.client import RemoteDisconnected
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from src.preprocessing.crawler import Crawler, infer_type, is_static_resource, normalize_url
from src.preprocessing.result_summary import summarize


class DemoHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/sitemap.xml":
            body = f"""<?xml version='1.0'?><urlset><url><loc>http://127.0.0.1:{self.server.server_port}/from-sitemap</loc></url></urlset>""".encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/xml")
        elif path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/users/456/profile")
            self.end_headers()
            return
        elif path == "/image.png":
            body = b"PNG"
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
        elif path == "/priority-fixture":
            body = """<html><body>
              <form id='searchForm' action='/search' method='post'>
                <input name='__VIEWSTATE' type='hidden' value='secret-token'>
                <label for='keyword'>검색어</label>
                <input id='keyword' name='q' placeholder='검색어 입력' minlength='2' required>
                <label>분류 <select name='category'><option>전체</option></select></label>
                <button type='submit'><span>검색</span></button>
              </form>
              <form id='internalForm' action='/internal' method='post'>
                <input name='__EVENTVALIDATION' type='hidden' value='secret-token'>
              </form>
              <input id='standalone' name='filter' aria-label='목록 필터'>
              <div role='button' id='openModal'><span>상세 보기</span></div>
              <button id='modalButton' data-bs-toggle='modal' aria-controls='detailDialog'>자세히</button>
              <button id='disabledButton' disabled hidden>사용 불가</button>
              <button onclick=\"location.href='/result'\">결과 이동</button>
            </body></html>""".encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
        elif path == "/":
            body = b"""<html><head><title>Demo</title></head><body>
              <a href='/product?utm_source=x&id=2#detail'>product two</a>
              <a href='/product?id=1'>product one</a>
              <a href='/users/123/profile'>profile</a>
              <a href='/redirect'>redirect</a>
              <a href='/duplicate-a'>duplicate a</a>
              <a href='/duplicate-b'>duplicate b</a>
              <a href='/delete/account'>danger</a>
              <a href='/image.png'>image</a>
              <a href='https://example.com/out'>external</a>
              <form action='/search' method='get'><input name='q' required></form>
              <form action='/api/users' method='post'><input name='name'><input name='avatar' type='file'></form>
              <button onclick=\"location.href='/announce'\">go</button>
              <script>fetch('/api/items?limit=10', {method: 'GET'}); fetch('/api/save', {method: 'POST'});</script>
            </body></html>"""
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
        elif path in {"/duplicate-a", "/duplicate-b"}:
            body = b"<html><body>same</body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
        else:
            body = ("<html><body>" + path + "</body></html>").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class CrawlerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), DemoHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_normalization(self):
        self.assertEqual(
            normalize_url("HTTP://Example.COM:80/page?utm_source=x&id=3#detail"),
            "http://example.com/page?id=3",
        )
        self.assertEqual(infer_type("123"), "integer")
        self.assertEqual(infer_type("550e8400-e29b-41d4-a716-446655440000"), "uuid")
        self.assertEqual(normalize_url("https://example.com/첨부 파일.pdf"), "https://example.com/%EC%B2%A8%EB%B6%80%20%ED%8C%8C%EC%9D%BC.pdf")
        self.assertTrue(is_static_resource("https://example.com/download/guide.pdf"))
        self.assertTrue(is_static_resource("https://example.com/data.csv"))

    def test_crawl_scope_grouping_and_safety(self):
        result = Crawler(self.base + "/", max_depth=2, max_pages=30).crawl()
        patterns = {(item["method"], item["url_pattern"]): item for item in result["endpoints"]}
        self.assertIn(("GET", "/product?id={integer}"), patterns)
        self.assertIn(("GET", "/users/{integer}/profile"), patterns)
        self.assertIn(("POST", "/api/users"), patterns)
        self.assertIn(("GET", "/search?q={string}"), patterns)
        self.assertIn(("GET", "/api/items?limit={integer}"), patterns)
        self.assertIn(("POST", "/api/save"), patterns)
        self.assertIn(("GET", "/announce"), patterns)
        self.assertTrue(any(item["reason"] == "dangerous_action" for item in result["blocked"]))
        self.assertTrue(any(item["reason"] == "static_resource" for item in result["blocked"]))
        self.assertTrue(any("example.com" in url for url in result["external_urls"]))
        self.assertTrue(any(page["url"].endswith("/from-sitemap") for page in result["pages"]))
        self.assertNotIn("priority_score", patterns[("POST", "/api/users")])
        self.assertEqual(patterns[("POST", "/api/users")]["origin"], self.base)
        self.assertEqual(result["metrics"]["endpoints_by_method"]["POST"], 2)
        self.assertGreater(result["metrics"]["endpoints_by_discovery_method"]["static_link"], 0)
        summary = summarize(result)
        self.assertIn("HTTP 메서드별", summary)
        self.assertIn("발견 방식별", summary)
        json.dumps(result)

    def test_response_hash_deduplication(self):
        result = Crawler(self.base + "/", include_sitemap=False, max_depth=1).crawl()
        self.assertGreaterEqual(result["metrics"]["duplicate_pages"], 1)
        duplicate = next(page for page in result["pages"] if page["url"].endswith("/duplicate-b"))
        self.assertTrue(duplicate["duplicate_of"].endswith("/duplicate-a"))

    def test_network_disconnect_is_recorded_instead_of_crashing(self):
        crawler = Crawler(self.base + "/disconnect", include_sitemap=False, max_pages=1)
        with patch.object(crawler, "_fetch", side_effect=RemoteDisconnected("server closed connection")):
            result = crawler.crawl()
        self.assertEqual(result["metrics"]["failed_pages"], 1)
        self.assertEqual(result["pages"][0]["status"], 0)
        self.assertIn("RemoteDisconnected", result["pages"][0]["error"])

    def test_priority_evidence_is_collected_without_input_values(self):
        result = Crawler(self.base + "/priority-fixture", include_sitemap=False, max_depth=0).crawl()
        page = result["pages"][0]
        forms = {form["selector"]: form for form in page["forms"]}
        search = forms["#searchForm"]
        self.assertEqual(search["user_input_count"], 2)
        self.assertFalse(search["framework_only"])
        self.assertEqual(len(search["submit_controls"]), 1)
        fields = {item["name"]: item for item in page["inputs"]}
        self.assertEqual(fields["q"]["label"], "검색어")
        self.assertEqual(fields["category"]["label"], "분류")
        self.assertEqual(fields["q"]["form_selector"], "#searchForm")
        self.assertEqual(fields["q"]["constraints"]["minlength"], "2")
        self.assertTrue(fields["__VIEWSTATE"]["framework_field"])
        self.assertFalse(fields["__VIEWSTATE"]["user_editable"])
        self.assertEqual(fields["filter"]["selector"], "#standalone")
        self.assertEqual(fields["filter"]["form_selector"], "")
        self.assertTrue(forms["#internalForm"]["framework_only"])
        self.assertEqual(forms["#internalForm"]["user_input_count"], 0)
        controls = {item["label"]: item for item in page["dynamic_candidates"]}
        self.assertEqual(controls["검색"]["form_selector"], "#searchForm")
        self.assertEqual(controls["검색"]["action_hint"], "form_submit")
        self.assertEqual(controls["상세 보기"]["selector"], "#openModal")
        self.assertEqual(controls["자세히"]["ui_state_hint"], "modal")
        self.assertEqual(controls["자세히"]["aria_controls"], "detailDialog")
        self.assertTrue(controls["사용 불가"]["disabled"])
        self.assertTrue(controls["사용 불가"]["hidden_markup"])
        self.assertEqual(controls["결과 이동"]["action_hint"], "javascript_navigation")
        self.assertEqual(controls["결과 이동"]["target_url"], self.base + "/result")
        self.assertNotIn("secret-token", json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
