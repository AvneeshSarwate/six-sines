// Test-only native editor host. Commands are JSON files in the supplied directory.
#include "ui/six-sines-editor.h"
#include "ui/matrix-panel.h"
#include "ui/matrix-sub-panel.h"
#include "ui/source-panel.h"
#include "dsp/sintable.h"
#include "synth/matrix_index.h"
#include <juce_gui_extra/juce_gui_extra.h>

using namespace baconpaul::six_sines;
struct ReferenceApp : juce::JUCEApplication, juce::Timer
{
    std::unique_ptr<Synth> synth;
    std::unique_ptr<ui::SixSinesEditor> editor;
    std::unique_ptr<juce::DocumentWindow> window;
    juce::File dir;
    clap_host_t host{CLAP_VERSION, nullptr, "UI reference", "Six Sines", "", "1",
        [](const clap_host_t *, const char *) -> const void * { return nullptr; },
        [](const clap_host_t *) {}, [](const clap_host_t *) {}, [](const clap_host_t *) {}};
    const juce::String getApplicationName() override { return "Six Sines UI Reference"; }
    const juce::String getApplicationVersion() override { return "1"; }
    void initialise(const juce::String &args) override
    {
        dir = juce::File(args.trim().unquoted());
        dir.createDirectory();
        auto userData = dir.getChildFile("user-data");
        userData.createDirectory();
        setenv("SIX_SINES_TEST_USER_DATA_DIR", userData.getFullPathName().toRawUTF8(), 1);
        synth = std::make_unique<Synth>(false);
        editor = std::make_unique<ui::SixSinesEditor>(
            synth->patchMain, synth->wavetableHandoff, synth->audioToMain, synth->mainToAudio,
            synth->audioOutputRing, synth->editorActive, synth->uiForceRebuild,
            synth->dawStateMain, *synth->defaultsProvider, &host);
        editor->setSize(ui::SixSinesEditor::edWidth, ui::SixSinesEditor::edHeight);
        window = std::make_unique<juce::DocumentWindow>(getApplicationName(),
            juce::Colours::black, juce::DocumentWindow::closeButton);
        window->setUsingNativeTitleBar(true);
        window->setContentNonOwned(editor.get(), true);
        window->centreWithSize(editor->getWidth(), editor->getHeight());
        window->setVisible(true);
        juce::Process::makeForegroundProcess();
        window->toFront(true);
        startTimer(100);
        dir.getChildFile("ready").replaceWithText("ready");
    }
    void shutdown() override
    {
        stopTimer();
        window.reset(); editor.reset(); synth.reset();
    }
    juce::Component *control(const juce::String &name)
    {
        auto i = MatrixIndex::positionForSourceTarget(4, 5);
        if (name == "route") return editor->matrixPanel->Mknobs[i].get();
        if (name == "power") return editor->matrixPanel->Mpower[i].get();
        if (name == "source") return editor->matrixSubPanel->sourceMenu[0].get();
        if (name == "target") return editor->matrixSubPanel->targetMenu[0].get();
        if (name == "depth") return editor->matrixSubPanel->depthSlider[0].get();
        return nullptr;
    }
    void capture(const juce::String &name)
    {
        auto &desktop = juce::Desktop::getInstance();
        auto bounds = editor->getScreenBounds();
        for (int i = 0; i < desktop.getNumComponents(); ++i)
        {
            auto *c = desktop.getComponent(i);
            if (c != window.get() && c->isVisible()) bounds = bounds.getUnion(c->getScreenBounds());
        }
        juce::Image image(juce::Image::RGB, bounds.getWidth(), bounds.getHeight(), true);
        juce::Graphics g(image);
        auto draw = [&](juce::Component *c)
        {
            auto p = c->getScreenPosition() - bounds.getPosition();
            g.drawImageAt(c->createComponentSnapshot(c->getLocalBounds()), p.x, p.y);
        };
        draw(editor.get());
        for (int i = 0; i < desktop.getNumComponents(); ++i)
        {
            auto *c = desktop.getComponent(i);
            if (c != window.get() && c->isVisible()) draw(c);
        }
        auto stream = dir.getChildFile(name + ".png").createOutputStream();
        stream->setPosition(0);
        stream->truncate();
        juce::PNGImageFormat().writeImageToStream(image, *stream);
    }
    void timerCallback() override
    {
        auto file = dir.getChildFile("command.json");
        if (!file.existsAsFile()) return;
        auto v = juce::JSON::parse(file.loadFileAsString());
        file.deleteFile();
        auto op = v["op"].toString();
        auto name = v["name"].toString();
        juce::String result = "ok";
        if (op == "schema")
        {
            auto root = new juce::DynamicObject();
            juce::Array<juce::var> params, nodes, sources;
            for (auto *p : synth->patchMain.params)
            {
                auto o = new juce::DynamicObject();
                auto &m = p->meta;
                o->setProperty("id", (int)m.id); o->setProperty("name", juce::String(m.name));
                o->setProperty("group", juce::String(m.groupName)); o->setProperty("type", (int)m.type);
                o->setProperty("min", m.minVal); o->setProperty("max", m.maxVal);
                o->setProperty("default", m.defaultVal); o->setProperty("scale", (int)m.displayScale);
                o->setProperty("unit", juce::String(m.unit)); o->setProperty("digits", m.decimalPlaces);
                o->setProperty("a", m.svA); o->setProperty("b", m.svB);
                o->setProperty("c", m.svC); o->setProperty("d", m.svD);
                juce::Array<juce::var> opts;
                std::map<int, std::string> sorted(m.discreteValues.begin(), m.discreteValues.end());
                for (auto &[id, label] : sorted)
                {
                    auto q = new juce::DynamicObject(); q->setProperty("value", id);
                    q->setProperty("label", juce::String(label)); opts.add(juce::var(q));
                }
                o->setProperty("options", opts); params.add(juce::var(o));
            }
            auto addNode = [&](auto &n, const juce::String &kind, int index)
            {
                auto o = new juce::DynamicObject();
                o->setProperty("kind", kind); o->setProperty("index", index);
                o->setProperty("group", juce::String(n.attack.meta.groupName));
                juce::Array<juce::var> ids, targets, ms, mt, md;
                for (auto *p : n.params()) ids.add((int)p->meta.id);
                for (auto &[id, label] : n.targetList) if (id >= 0)
                { auto t = new juce::DynamicObject(); t->setProperty("value", id);
                  t->setProperty("label", juce::String(label)); targets.add(juce::var(t)); }
                for (int i=0;i<3;++i) { ms.add((int)n.modsource[i].meta.id);
                    mt.add((int)n.modtarget[i].meta.id); md.add((int)n.moddepth[i].meta.id); }
                o->setProperty("params", ids); o->setProperty("targets", targets);
                o->setProperty("modSource", ms); o->setProperty("modTarget", mt); o->setProperty("modDepth", md);
                nodes.add(juce::var(o));
            };
            auto &p = synth->patchMain;
            for (int i=0;i<6;++i) { addNode(p.sourceNodes[i], "source", i);
                addNode(p.selfNodes[i], "feedback", i); addNode(p.mixerNodes[i], "mixer", i);
                addNode(p.macroNodes[i], "macro", i); }
            for (int i=0;i<15;++i) addNode(p.matrixNodes[i], "matrix", i);
            addNode(p.output, "main", 0); addNode(p.fineTuneMod, "tune", 0); addNode(p.mainPanMod, "pan", 0);
            for (auto &s : editor->modMatrixConfig.sources)
            { auto o=new juce::DynamicObject(); o->setProperty("value", s.id);
              o->setProperty("label", juce::String(s.name)); o->setProperty("group", juce::String(s.group)); sources.add(juce::var(o)); }
            root->setProperty("params", params); root->setProperty("nodes", nodes); root->setProperty("sources", sources);
            dir.getChildFile("schema.json").replaceWithText(juce::JSON::toString(juce::var(root)));
        }
        else if (op == "waveforms")
        {
            auto root = new juce::DynamicObject();
            SinTable table;
            for (int w = 0; w < SinTable::AUDIO_IN; ++w)
            {
                table.setWaveForm(static_cast<SinTable::WaveForm>(w));
                juce::Array<juce::var> samples;
                for (int i = 0; i < 512; ++i)
                    samples.add(table.at(static_cast<uint32_t>(i) * (phase::phaseMax / 512)));
                root->setProperty(juce::Identifier(juce::String(w)), samples);
            }
            dir.getChildFile("waveforms.json").replaceWithText(juce::JSON::toString(juce::var(root)));
        }
        else if (op == "source") editor->sourcePanel->beginEdit((int)v["index"]);
        else if (op == "set")
        {
            const auto id = (int)v["id"];
            bool found = false;
            for (auto *p : synth->patchMain.params)
                if ((int)p->meta.id == id)
                { editor->setAndSendParamValue(*p, (float)v["value"]); found = true; break; }
            if (found) editor->rebuildFromPatchMain();
            else result = "error: unknown parameter";
        }
        else if (op == "normalize-presets")
        {
            const juce::File input(v["path"].toString());
            for (const auto &file : input.findChildFiles(juce::File::findFiles, true, "*.sxsnp"))
            {
                Patch patch;
                if (!patch.fromState(file.loadFileAsString().toStdString()))
                { result = "error: " + file.getFullPathName(); break; }
                auto output = dir.getChildFile("normalized").getChildFile(file.getRelativePathFrom(input));
                output.getParentDirectory().createDirectory();
                output.replaceWithText(patch.toState());
            }
        }
        else if (op == "capture") capture(name);
        else if (op == "tree")
        {
            juce::String tree;
            std::function<void(juce::Component *, int)> walk = [&](auto *c, int depth)
            {
                if (!c->isVisible()) return;
                tree += juce::String::repeatedString(" ", depth) + c->getName() + " | " +
                    c->getTitle() + " | " + c->getScreenBounds().toString() + "\n";
                for (auto *child : c->getChildren()) walk(child, depth + 1);
            };
            auto &d = juce::Desktop::getInstance();
            for (int i = 0; i < d.getNumComponents(); ++i) walk(d.getComponent(i), 0);
            dir.getChildFile(name + ".txt").replaceWithText(tree);
        }
        else if (op == "export")
            dir.getChildFile(name + ".sxsnp").replaceWithText(synth->patchMain.toState());
        else if (op == "load")
        {
            if (!synth->patchMain.fromState(juce::File(v["path"].toString()).loadFileAsString().toStdString()))
                result = "error: invalid preset";
            else editor->rebuildFromPatchMain();
        }
        else if (op == "click" || op == "drag")
        {
            if (auto *c = control(name))
            {
                auto p = c->getLocalBounds().getCentre().toFloat();
                juce::Desktop::setMousePosition(c->localPointToGlobal(p.toInt()));
                auto now = juce::Time::getCurrentTime();
                juce::MouseEvent e(juce::Desktop::getInstance().getMainMouseSource(), p,
                    juce::ModifierKeys::leftButtonModifier, 1, 0, 0, 0, 0, c, c, now, p, now, 1, false);
                c->mouseDown(e);
                if (op == "drag")
                {
                    auto end = p + juce::Point<float>((float)v["dx"], (float)v["dy"]);
                    juce::MouseEvent dragged(juce::Desktop::getInstance().getMainMouseSource(), end,
                        juce::ModifierKeys::leftButtonModifier, 1, 0, 0, 0, 0, c, c, now, p, now, 1, true);
                    c->mouseDrag(dragged);
                    c->mouseUp(dragged);
                }
                else c->mouseUp(e);
                if (auto *modal = juce::Component::getCurrentlyModalComponent())
                {
                    modal->toFront(true);
                    modal->grabKeyboardFocus();
                    juce::Desktop::setMousePosition(modal->getScreenBounds().getCentre());
                    capture("menu-immediate");
                    if (auto *keys = v["keys"].getArray())
                    {
                        int step = 0;
                        for (auto &key : *keys)
                        {
                            auto k = key.toString();
                            int code = k == "down" ? juce::KeyPress::downKey :
                                k == "right" ? juce::KeyPress::rightKey : juce::KeyPress::returnKey;
                            auto *receiver = juce::Component::getCurrentlyModalComponent();
                            if (!receiver) { result = "error: popup disappeared"; break; }
                            if (!receiver->keyPressed(juce::KeyPress(code)))
                            { result = "error: popup rejected key"; break; }
                            capture(name + "-key-" + juce::String(++step));
                        }
                    }
                }
                dir.getChildFile("click-state.txt").replaceWithText(c->getTitle() +
                    " enabled=" + juce::String((int)c->isEnabled()) + " modal=" +
                    juce::String(juce::Component::getNumCurrentlyModalComponents()));
            }
            else result = "error: unknown control";
        }
        else if (op == "key")
        {
            auto *c = juce::Component::getCurrentlyModalComponent();
            if (!c) c = juce::Component::getCurrentlyFocusedComponent();
            int code = (int)v["code"];
            if (name == "down") code = juce::KeyPress::downKey;
            if (name == "right") code = juce::KeyPress::rightKey;
            if (name == "return") code = juce::KeyPress::returnKey;
            if (name == "escape") code = juce::KeyPress::escapeKey;
            if (c) c->keyPressed(juce::KeyPress(code));
            else result = "error: no focus";
        }
        else if (op == "quit") quit();
        else result = "error: unknown command";
        dir.getChildFile("response.json").replaceWithText(juce::JSON::toString(
            juce::var(result)));
    }
};
START_JUCE_APPLICATION(ReferenceApp)
