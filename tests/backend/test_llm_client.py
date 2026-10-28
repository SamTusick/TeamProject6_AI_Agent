"""Offline tests for the model client's timeout and fallback behavior."""

import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.setdefault("NRP_API_KEY", "test-key")
os.environ.setdefault("NRP_BASE_URL", "http://localhost:1/v1")

import httpx  # noqa: E402
from openai import APITimeoutError  # noqa: E402

from backend.core import llm_client  # noqa: E402


def reply(content):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def timeout_error():
    return APITimeoutError(request=httpx.Request("POST", "http://localhost:1/v1"))


class FallbackTests(unittest.TestCase):
    def setUp(self):
        llm_client._failed_models.clear()

    def run_with(self, side_effect, calls=1):
        create = AsyncMock(side_effect=side_effect)
        with patch.object(llm_client, "MODEL_NAME", "primary"), \
                patch.object(llm_client, "FALLBACK_MODELS", ["backup", "last"]), \
                patch.object(llm_client.client.chat.completions, "create", create):
            results = []
            for _ in range(calls):
                try:
                    results.append(asyncio.run(llm_client.complete_json([{"role": "user", "content": "hi"}])))
                except RuntimeError as error:
                    results.append(error)
        return results[-1], [call.kwargs["model"] for call in create.call_args_list]

    def test_primary_success_makes_one_call(self):
        result, models = self.run_with([reply('{"ok": 1}')])
        self.assertEqual(result, '{"ok": 1}')
        self.assertEqual(models, ["primary"])

    def test_timeout_falls_back_to_next_model(self):
        result, models = self.run_with([timeout_error(), reply('{"ok": 2}')])
        self.assertEqual(result, '{"ok": 2}')
        self.assertEqual(models, ["primary", "backup"])

    def test_empty_reply_counts_as_failure(self):
        result, models = self.run_with([reply(""), timeout_error(), reply('{"ok": 3}')])
        self.assertEqual(result, '{"ok": 3}')
        self.assertEqual(models, ["primary", "backup", "last"])

    def test_failed_model_is_skipped_on_later_calls(self):
        result, models = self.run_with([timeout_error(), reply('{"a": 1}'), reply('{"b": 2}')], calls=2)
        self.assertEqual(result, '{"b": 2}')
        self.assertEqual(models, ["primary", "backup", "backup"])

    def test_all_models_failing_raises(self):
        result, models = self.run_with([timeout_error(), timeout_error(), timeout_error()])
        self.assertIsInstance(result, RuntimeError)
        self.assertEqual(models, ["primary", "backup", "last"])


if __name__ == "__main__":
    unittest.main()
