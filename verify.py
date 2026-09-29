"""Quote-verification guardrail.

Independently checks that a model-provided source quote actually
appears in the transcript (whitespace/case-normalized substring
check), instead of trusting the model's own classification. This is
the core defense against a hallucinated or misattributed "decision."

Filled in during Step 5.
"""

# TODO (Step 5): normalize(text) -> collapse whitespace, lowercase.
# TODO (Step 5): quote_found_in_transcript(quote, transcript) -> bool.
