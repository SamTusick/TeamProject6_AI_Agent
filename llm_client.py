"""NRP model client: connection setup + the classification call.

Filled in during Step 3 (trivial connection test) and Step 4
(system prompt + JSON classification). Reuses the same AsyncOpenAI
client pattern as the class chapter_02/chapter_03 scripts, but calls
chat.completions.create() directly instead of going through the
OpenAI Agents SDK's Agent/Runner, so this script - not the model -
controls when anything gets written to disk.
"""

# TODO (Step 3): load .env, construct AsyncOpenAI client, prove NRP responds.
# TODO (Step 4): system prompt, JSON schema, defensive parsing of model output.
