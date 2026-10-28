import unittest

from backend.workers.analysis_worker import review_items


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.transcript = "Taylor: I will send the report by Friday."
        self.item = dict(title="Send report", owner="Taylor", deadline="Friday",
                         classification="CONFIRMED", quote="I will send the report by Friday.")

    def test_confirmed_quote_is_eligible(self):
        result = review_items([self.item], self.transcript)[0]
        self.assertTrue(result["verified"])
        self.assertTrue(result["eligible"])

    def test_bad_quote_is_never_eligible(self):
        for classification in ("CONFIRMED", "NEEDS_INFO", "TENTATIVE", "DISCUSSED_ONLY"):
            item = dict(self.item, classification=classification, quote="Invented quote")
            result = review_items([item], self.transcript)[0]
            self.assertFalse(result["verified"])
            self.assertFalse(result["eligible"])

    def test_missing_owner_or_deadline_is_ineligible(self):
        for field in ("owner", "deadline"):
            result = review_items([dict(self.item, **{field: None})], self.transcript)[0]
            self.assertFalse(result["eligible"])

    def test_malformed_fields_are_safe(self):
        result = review_items([None, {"quote": ["invalid"]}], self.transcript)
        self.assertEqual(len(result), 1)
        self.assertFalse(result[0]["eligible"])


if __name__ == "__main__":
    unittest.main()