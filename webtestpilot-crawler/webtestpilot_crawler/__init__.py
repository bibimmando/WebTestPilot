"""WebTestPilot crawler prototype."""

from .config import CrawlConfig, CrawlLimits, QueryParamPolicy
from .crawler import WebTestPilotCrawler

__all__ = ["CrawlConfig", "CrawlLimits", "QueryParamPolicy", "WebTestPilotCrawler"]
__version__ = "0.1.0"

