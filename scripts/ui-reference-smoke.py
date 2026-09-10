#!/usr/bin/env python3
"""Exercise the running native reference host; no parameters are assigned directly."""
import json
import pathlib
import subprocess
import sys
import xml.etree.ElementTree as ET

directory = pathlib.Path(sys.argv[1]).resolve()
driver = pathlib.Path(__file__).with_name("ui-reference-command.py")


def send(op, **kwargs):
    subprocess.run([sys.executable, str(driver), str(directory),
                    json.dumps(dict(op=op, **kwargs))], check=True)


def params(name):
    return {int(p.attrib["id"]): float(p.attrib["v"])
            for p in ET.parse(directory / (name + ".sxsnp")).findall("./params/p")}


# First run expects a fresh host. Later runs restore this same native-exported fixture.
baseline = directory / "smoke-before.sxsnp"
if baseline.exists():
    send("load", path=str(baseline))
else:
    send("export", name="smoke-before")
send("capture", name="smoke-initial")
send("click", name="route")
send("capture", name="smoke-route")
send("click", name="source", keys=["down"] * 5 + ["right", "return"])
send("click", name="target", keys=["down", "down", "return"])
send("click", name="power")
send("drag", name="depth", dx=30, dy=-30)
send("export", name="smoke-after")
send("capture", name="smoke-assigned")
before, after = params("smoke-before"), params("smoke-after")
changes = {k: [before.get(k), v] for k, v in after.items() if before.get(k) != v}
assert after[32870] == 400, changes  # Macro 1 Amplitude
assert after[32880] == 10, changes  # Level
assert after[32801] == 1, changes  # Route enabled
assert after[32871] > 0, changes  # Depth changed by drag
assert set(changes) == {32870, 32880, 32801, 32871}, changes
send("load", path=str(directory / "smoke-after.sxsnp"))
send("export", name="smoke-roundtrip")
assert params("smoke-roundtrip") == after
report = {"status": "passed", "changes": changes,
          "nativePresetRoundtrip": "passed",
          "input": "JUCE control mouse handlers and popup keyboard handlers; not OS input"}
(directory / "smoke-result.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
