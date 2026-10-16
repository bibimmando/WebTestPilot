import unittest

from playwright.async_api import async_playwright
from integration.preprocessor.state_evidence import STATE_JS


class StateEvidenceTest(unittest.IsolatedAsyncioTestCase):
    async def test_generic_dom_values_scope_omissions_and_read_only_collection(self):
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content('<header><a href="/basket">Basket 3</a></header><main>'
                    '<ul><li><a href="/entry">Example entry</a> $12</li></ul>'
                    '<input type="number" aria-label="Quantity" value="3">'
                    '<input type="password" value="DO_NOT_COLLECT">'
                    '<button onclick="document.body.dataset.changed=1">Increase</button>'
                    '<output>3 items</output><div hidden><li>Hidden</li></div></main>')
                data = await page.evaluate(STATE_JS)
                self.assertEqual(data['scope'], 'main')
                self.assertEqual(data['candidates']['total'], 1)
                self.assertEqual(next(x['text'] for x in data['numeric_and_status']['items'] if x['tag'] == 'output'), '3 items')
                self.assertNotIn('DO_NOT_COLLECT', str(data))
                self.assertIsNone(await page.get_attribute('body', 'data-changed'))
                await page.locator('main').evaluate('(e) => e.innerHTML = "<ul>" + "<li>Entry</li>".repeat(95) + "</ul>"')
                bounded = await page.evaluate(STATE_JS)
                self.assertEqual(len(bounded['candidates']['items']), 80)
                self.assertEqual(bounded['omitted']['candidate_rows'], 15)
            finally:
                await browser.close()


if __name__ == '__main__':
    unittest.main()
