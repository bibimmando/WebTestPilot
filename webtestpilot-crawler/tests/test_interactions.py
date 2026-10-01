from webtestpilot_crawler.interactions import EventRecorder, discover_actions


def test_safe_mode_blocks_submit_and_destructive_wording():
    semantic = {
        "controls": [
            {"selector": "#save", "label": "Save", "formSubmit": False, "disabled": False},
            {"selector": "#delete", "label": "삭제", "formSubmit": False, "disabled": False},
            {"selector": "#submit", "label": "Continue", "formSubmit": True, "disabled": False},
        ],
        "hoverControls": [{"selector": "#menu", "label": "Products"}],
    }
    actions = discover_actions(semantic, safe_only=True)
    risks = {item.selector: item.risk for item in actions}
    assert risks["#save"] == "safe"
    assert risks["#delete"] == "blocked"
    assert risks["#submit"] == "blocked"
    assert risks["#menu"] == "safe"


def test_event_recorder_keeps_successful_network_activity():
    class Request:
        method = "GET"
        resource_type = "fetch"

    class Response:
        url = "https://example.com/data"
        status = 200
        request = Request()

    recorder = EventRecorder()
    recorder._on_response(Response())

    assert recorder.responses == [
        {
            "url": "https://example.com/data",
            "status": 200,
            "method": "GET",
            "resource_type": "fetch",
        }
    ]
    assert recorder.response_errors == []


def test_read_only_load_more_is_allowed_even_when_nested_in_form():
    semantic = {
        "controls": [
            {
                "selector": "#more",
                "label": "Load More",
                "formSubmit": True,
                "disabled": False,
            }
        ]
    }
    assert discover_actions(semantic, safe_only=True)[0].risk == "safe"
