#!/usr/bin/env python3
"""Send one command to the test-only JUCE reference app."""
import json
import pathlib
import sys
import time

directory = pathlib.Path(sys.argv[1])
command = json.loads(sys.argv[2])
response = directory / "response.json"
response.unlink(missing_ok=True)
temp = directory / "command.pending"
temp.write_text(json.dumps(command))
temp.replace(directory / "command.json")
deadline = time.monotonic() + 15
while time.monotonic() < deadline:
    if response.exists():
        try:
            result = json.loads(response.read_text())
        except json.JSONDecodeError:
            continue
        print(result)
        sys.exit(0 if result == "ok" else 1)
    time.sleep(0.05)
raise SystemExit("Timed out waiting for native reference app")
