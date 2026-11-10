"""CC GUI integration uses scratch directories, never the installed desktop client."""
import contextlib
import base64
import importlib.util
import io
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ccgui_integrate', REPO / 'tools/integrate.py')
integrate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(integrate)


class CcguiIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.home = self.root / 'ccgui'
        self.support = self.root / 'pet'
        self.state = self.root / 'state'
        self.home.mkdir()
        (self.home / 'config.json').write_text('{}')
        self.registry = self.home / 'plugins.json'
        self.other = {'version': '2.0.0', 'enabled': True, 'permissions': ['storage']}
        self.registry.write_text(json.dumps({'plugins': {'other': self.other}, 'documentStorage': {'other': {'kind': 'data'}}, 'custom': 42}))
        self.patch = mock.patch.multiple(integrate, CCGUI_HOME=self.home, SUPPORT=self.support, STATE_DIR=self.state, create=True)
        self.patch.start()
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()

    def tearDown(self):
        self.output.__exit__(None, None, None)
        self.patch.stop()
        self.tmp.cleanup()

    def test_install_update_uninstall_preserve_other_plugins_and_settings(self):
        integrate.ccgui(True)
        token = json.loads((self.support / 'ccgui-bridge.json').read_text())['token']
        integrate.ccgui(True)
        self.assertEqual(json.loads((self.support / 'ccgui-bridge.json').read_text())['token'], token)
        data = json.loads(self.registry.read_text())
        self.assertEqual(data['plugins']['other'], self.other)
        self.assertEqual(data['custom'], 42)
        self.assertTrue(integrate.has_ccgui())
        self.assertIn('ccgui', integrate.installed())
        plugin = self.home / 'plugins/crosspet'
        manifest = json.loads((plugin / 'manifest.json').read_text(encoding='utf-8'))
        self.assertIn('runtime.events.read', manifest['permissions'])
        source = (plugin / 'main.js').read_text(encoding='utf-8')
        self.assertNotIn('const CONFIG = null', source)
        self.assertTrue((self.support / 'crosspet-hook.py').exists())
        self.assertTrue(list(self.home.glob('plugins.json.bak-crosspet-*')))
        integrate.ccgui(False)
        self.assertFalse(integrate.has_ccgui())
        data = json.loads(self.registry.read_text())
        self.assertEqual(data['plugins']['other'], self.other)
        self.assertEqual(data['documentStorage'], {'other': {'kind': 'data'}})
        self.assertEqual(data['custom'], 42)

    def test_invalid_marker_gets_a_new_token_and_revocation_does_not_reuse_it(self):
        self.support.mkdir()
        marker = self.support / 'ccgui-bridge.json'
        for saved in ('{invalid', '[]', 'null', '{}', '{"token": null}', '{"token": 42}', '{"token": ""}'):
            with self.subTest(saved=saved):
                marker.write_text(saved)
                integrate.ccgui(True)
                token = json.loads(marker.read_text())['token']
                self.assertIsInstance(token, str)
                self.assertTrue(token)
        integrate.ccgui(False)
        self.assertFalse(marker.exists())
        integrate.ccgui(True)
        self.assertNotEqual(json.loads(marker.read_text())['token'], token)

    def test_missing_client_does_not_create_config(self):
        with mock.patch.object(integrate, 'CCGUI_HOME', self.root / 'missing'):
            integrate.ccgui(True)
            integrate.ccgui(False)
        self.assertFalse((self.root / 'missing').exists())

    def test_disabled_or_quarantined_plugin_is_not_connected(self):
        integrate.ccgui(True)
        for field in ('enabled', 'quarantined'):
            data = json.loads(self.registry.read_text())
            data['plugins']['crosspet'][field] = field != 'enabled'
            self.registry.write_text(json.dumps(data))
            self.assertFalse(integrate.has_ccgui())
            integrate.ccgui(True)

    def test_invalid_registry_is_not_overwritten(self):
        self.registry.write_text('{invalid')
        with self.assertRaises(ValueError):
            integrate.ccgui(True)
        self.assertEqual(self.registry.read_text(), '{invalid')

    def test_bridge_metadata_reaches_real_hook_with_model_and_client_routing(self):
        integrate.ccgui(True)
        (self.support / 'ai-autostart-off').write_text('test')
        for character in ('gpt', 'deepseek'):
            folder = self.support / 'characters' / character
            folder.mkdir(parents=True)
            (folder / 'character.json').write_text('{}')
            (folder / 'idle.webp').write_bytes(b'test')
        env = {k: v for k, v in os.environ.items() if k not in ('GROK_HOOK_EVENT', 'CLAUDE_CODE_ENTRYPOINT')}
        env.update(CROSSPET_DATA_DIR=str(self.support), CROSSPET_STATE_DIR=str(self.state),
                   CROSSPET_CCGUI_TOKEN=json.loads((self.support / 'ccgui-bridge.json').read_text())['token'])
        base = {'session_id': 'ccgui:codex:s1', 'turn_id': 't1', 'model': 'codex'}
        def fire(name, **extra):
            payload = dict(base, hook_event_name=name, **extra)
            if name == 'SessionEnd':
                payload.pop('turn_id')
            encoded = base64.b64encode(json.dumps(payload).encode('utf-8')).decode('ascii')
            p = subprocess.run([sys.executable, str(REPO / 'integrations/crosspet-hook.py'), 'ccgui', '--event-base64', encoded],
                               capture_output=True, env=env, timeout=10)
            self.assertEqual(p.returncode, 0, p.stderr.decode('utf-8', 'replace'))
        fire('UserPromptSubmit')
        self.assertIn(base['session_id'], json.loads((self.state / 'gpt-sessions.json').read_text()))
        fire('SessionEnd')
        self.assertEqual(json.loads((self.state / 'gpt@ccgui-state.json').read_text())['pose'], 'sleeping')
        self.assertNotIn(base['session_id'], json.loads((self.state / 'gpt-sessions.json').read_text()))
        base['model'] = 'deepseek-v4'
        fire('PreToolUse', tool_name='Read')
        state = json.loads((self.state / 'deepseek@ccgui-state.json').read_text())
        self.assertEqual((state['pose'], state['client'], state['host']), ('reading', 'ccgui', 'ccgui'))
        sessions = json.loads((self.state / 'deepseek-sessions.json').read_text())
        self.assertEqual(sessions[base['session_id']]['client'], 'ccgui')
        route = json.loads((self.state / 'ccgui-host.json').read_text())
        self.assertEqual((route['character'], route['model']), ('deepseek', 'deepseek-v4'))
        fire('Stop')
        fire('PreToolUse', tool_name='Bash')
        self.assertEqual(json.loads((self.state / 'deepseek@ccgui-state.json').read_text())['event'], 'Stop')

    def test_untrusted_bridge_calls_do_not_write_state(self):
        integrate.ccgui(True)
        marker = self.support / 'ccgui-bridge.json'
        token = json.loads(marker.read_text())['token']
        payload = json.dumps({'hook_event_name': 'PreToolUse', 'session_id': 'ccgui:s1',
                              'model': 'deepseek-v4', 'tool_name': 'Read'}).encode()
        cases = [(json.dumps({'token': token}), None), (json.dumps({'token': token}), 'wrong'),
                 ('{}', None), ('{"token": ""}', ''), ('{"token": 42}', '42'),
                 ('[]', token), ('null', token), ('{invalid', token), (None, token)]
        for i, (saved, supplied) in enumerate(cases):
            with self.subTest(saved=saved, supplied=supplied):
                if saved is None:
                    marker.unlink(missing_ok=True)
                else:
                    marker.write_text(saved)
                env = {k: v for k, v in os.environ.items() if k != 'CROSSPET_CCGUI_TOKEN'}
                state = self.state / str(i)
                env.update(CROSSPET_DATA_DIR=str(self.support), CROSSPET_STATE_DIR=str(state))
                if supplied is not None:
                    env['CROSSPET_CCGUI_TOKEN'] = supplied
                result = subprocess.run([sys.executable, str(REPO / 'integrations/crosspet-hook.py'), 'ccgui'],
                                        input=payload, capture_output=True, env=env, timeout=10)
                self.assertEqual((result.returncode, result.stderr), (0, b''))
                self.assertFalse(list(state.glob('*.json')))
                record = json.loads((self.support / 'events/ccgui.jsonl').read_text().splitlines()[-1])
                self.assertEqual((record['result'], record['detail']), ('dropped', 'ccgui-disconnected'))

    @unittest.skipUnless(os.name == 'nt' and shutil.which('node') and shutil.which('powershell'), 'Windows, Node and PowerShell required')
    def test_generated_plugin_runs_bundled_python_and_revocation_blocks_old_commands(self):
        self.support = self.root / "宠物's files"
        with mock.patch.object(integrate, 'SUPPORT', self.support):
            integrate.ccgui(True)
            (self.support / 'ai-autostart-off').write_text('test')
            character = self.support / 'characters/gpt'
            character.mkdir(parents=True)
            (character / 'character.json').write_text('{}')
            (character / 'idle.webp').write_bytes(b'test')
            # Load the exact installed plugin. The mock is only the SDK transport;
            # run its generated command through the real Windows PowerShell below.
            script = '''
import { readFile } from 'node:fs/promises';
const source = await readFile(process.argv[1], 'utf8');
const { default: activate } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
let hooks;
activate({ events: { on() {} }, hooks: { registerTurnHooks(h) { hooks = h }, registerSessionHooks() {} },
  bridge: { async invoke(_, args) { console.log(JSON.stringify(args)); return { code: 0 }; } } });
const e = { runId: 'run', turnId: 'turn', engine: 'codex', sessionId: 'session' };
hooks.onTurnStarted(e);
hooks.onRuntimeEvent({ ...e, kind: 'command-started', command: 'SECRET' });
hooks.afterTurn({ ...e, status: 'completed' });
'''
            plugin = self.home / 'plugins/crosspet/main.js'
            p = subprocess.run([shutil.which('node'), '--input-type=module', '-e', script, str(plugin)],
                               capture_output=True, encoding='utf-8', timeout=10)
            self.assertEqual(p.returncode, 0, p.stderr)
            calls = [json.loads(line) for line in p.stdout.splitlines()]
            self.assertEqual(len(calls), 3)
            state_file = self.state / 'gpt@ccgui-state.json'
            for call, pose in zip(calls, ('listening', 'running', 'happy')):
                # Commands captured from the running plugin must survive a refresh.
                integrate.ccgui(True)
                env = {**os.environ, **call['env']}
                result = subprocess.run([shutil.which(call['bin']), *call['args']], env=env,
                                        capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', 'replace'))
                self.assertTrue(state_file.exists(), 'the running plugin must remain connected after refresh')
                self.assertEqual(json.loads(state_file.read_text())['pose'], pose)
            before = state_file.read_text()
            integrate.ccgui(False)
            call = calls[0]
            result = subprocess.run([shutil.which(call['bin']), *call['args']], env={**os.environ, **call['env']},
                                    capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(state_file.read_text(), before)


if __name__ == '__main__':
    unittest.main()
