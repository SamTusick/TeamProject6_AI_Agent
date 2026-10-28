import unittest

from speech.text import CHAR_TO_ID, decode_ctc, encode, normalize_transcript


class SpeechTextTests(unittest.TestCase):
    def test_normalization(self):
        self.assertEqual(normalize_transcript("HELLO,   it's Friday!"), "hello it's friday")

    def test_blank_is_not_a_transcript_token(self):
        self.assertNotIn(0, encode("hello world"))
        with self.assertRaises(ValueError):
            encode("123 !!!")

    def test_ctc_collapses_repeats_but_blank_separates_letters(self):
        letter = CHAR_TO_ID["l"]
        self.assertEqual(decode_ctc([0, letter, letter, 0, letter]), "ll")
        self.assertEqual(decode_ctc([0, 0]), "")


if __name__ == "__main__":
    unittest.main()