import contextlib
import os
import importlib.util
import io
import json
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

spec = importlib.util.spec_from_file_location('integrate', Path(__file__).resolve().parents[1] / 'tools/integrate.py')
integrate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(integrate)

class IntegrationTests(unittest.TestCase):
    # 插件版本检查（只读）：自带的 / 装到 Harness 那边的 / Harness 里正在跑的，设置页和桌宠据此提醒用户点「更新」
    def _plugin_dirs(self, tmp, bundled='1.3.5', installed='1.3.4', running='1.3.2'):
        b = Path(tmp) / 'bundled.js'; b.write_text(f'const PLUGIN_VERSION = "{bundled}";')
        d = Path(tmp) / 'plugin'
        if installed:
            (d / 'lib').mkdir(parents=True); (d / 'lib/index.js').write_text(f'const PLUGIN_VERSION = "{installed}";  // x')
        st = Path(tmp) / 'state'; st.mkdir()
        if running: (st / 'deepseek-plugin.json').write_text('{"plugin": "%s", "apiKey": "ok"}' % running)
        return b, d, st
    def test_plugin_status_reports_three_versions(self):
        with tempfile.TemporaryDirectory() as tmp:
            b, d, st = self._plugin_dirs(tmp)
            got = integrate.plugin_status(['deepseek'], bundled=b, plugin_dir=d, state_dir=st)
        self.assertEqual(got, [{'id': 'deepseek', 'label': 'DeepSeek Harness', 'bundled': '1.3.5', 'installed': '1.3.4', 'running': '1.3.2'}])
    def test_plugin_status_only_for_integrated(self):
        with tempfile.TemporaryDirectory() as tmp:
            b, d, st = self._plugin_dirs(tmp)
            self.assertEqual(integrate.plugin_status(['codex'], bundled=b, plugin_dir=d, state_dir=st), [])
    def test_plugin_status_missing_files_are_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            b, d, st = self._plugin_dirs(tmp, installed=None, running=None)
            got = integrate.plugin_status(['deepseek'], bundled=b, plugin_dir=d, state_dir=st)
        self.assertEqual(got[0]['installed'], None); self.assertEqual(got[0]['running'], None); self.assertEqual(got[0]['bundled'], '1.3.5')
    def test_plugin_status_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            b, d, st = self._plugin_dirs(tmp)
            before = sorted((p, p.stat().st_mtime_ns) for p in Path(tmp).rglob('*'))
            integrate.plugin_status(['deepseek'], bundled=b, plugin_dir=d, state_dir=st)
            self.assertEqual(sorted((p, p.stat().st_mtime_ns) for p in Path(tmp).rglob('*')), before)
    def test_codex_programs_skips_desktop_gui_exe(self):
        # Codex 桌面版的图形界面程序旁边有 resources.pak 等文件：不能当命令行跑 --version（会弹窗口）
        with tempfile.TemporaryDirectory() as tmp:
            exe = Path(tmp) / 'codex'
            exe.write_text('#!/bin/sh\necho should-not-run\n'); exe.chmod(0o755)
            (Path(tmp) / 'resources.pak').write_text('')
            with mock.patch.dict(os.environ, {'CROSSPET_CODEX_BIN': str(exe)}):
                found = integrate.codex_programs()
        self.assertFalse(any(str(exe) in f for f in found), found)
    def test_codex_programs_lists_override_with_version(self):
        script = Path(__file__).resolve().parent / 'fake_codex.py'
        with tempfile.TemporaryDirectory() as tmp:
            fake = script
            if os.name == 'nt':
                # Windows 不能按 shebang 直接执行 .py：用临时 cmd 模拟安装的 Codex 命令。
                fake = Path(tmp) / 'fake_codex.cmd'
                fake.write_text(f'@echo off\n"{sys.executable}" "{script}" %*\n', encoding='utf-8')
            else:
                # Windows 工作树挂载进 WSL 后可能是 CRLF；显式用测试 Python，不依赖 .py 的 shebang。
                fake = Path(tmp) / 'fake_codex'
                fake.write_text('#!/bin/sh\nexec ' + shlex.join([sys.executable, str(script)]) + ' "$@"\n', encoding='utf-8')
                fake.chmod(0o755)
            with mock.patch.dict(os.environ, {'CROSSPET_CODEX_BIN': str(fake)}):
                found = integrate.codex_programs()
        self.assertTrue(found and found[0].startswith(str(fake)), found)
        self.assertIn('codex-cli 0.0.0-fake', found[0])
    def test_preserve_other_hook_in_same_group(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'settings.json'
            other = {'type': 'command', 'command': 'echo keep-me'}
            integrate.save_json(p, {'theme': 'dark', 'hooks': {'Stop': [{'matcher': '*', 'hooks': [other, {'command': 'python crosspet-hook.py'}]}]}})
            integrate.remove_hooks(p)
            self.assertEqual(integrate.load_json(p), {'theme': 'dark', 'hooks': {'Stop': [{'matcher': '*', 'hooks': [other]}]}})
    def test_repeated_install_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'settings.json'
            template = integrate.REPO / 'integrations/codex/hooks.json'
            integrate.merge_hooks(p, template)
            first = integrate.load_json(p)
            integrate.merge_hooks(p, template)
            self.assertEqual(first, integrate.load_json(p))

    # ---- Qwen Code ----
    # 每条事件必须是同一个命令：Windows 上 load_template 靠「命令以 macOS 那串开头」来改写成随包 Python，
    # 写法稍有出入就改写不到，接上去等于没接
    def test_qwen_template_uses_one_command_everywhere(self):
        hooks = integrate.load_json(integrate.REPO / 'integrations/qwen/hooks.json')['hooks']
        entries = [c for gs in hooks.values() for g in gs for c in g['hooks']]
        self.assertTrue(entries)
        self.assertEqual({e['command'] for e in entries}, {'python3 "$HOME/Library/Application Support/CrossPet/crosspet-hook.py" qwen'})
        self.assertTrue(all(e['type'] == 'command' for e in entries))
        # Qwen 的 timeout 是「秒」（Gemini CLI 才是毫秒）：抄 Gemini 模板的 5000 会被当成毫秒兼容值
        self.assertEqual({e['timeout'] for e in entries}, {5})
    @unittest.skipUnless(os.name == 'nt', '只在 Windows 上改写路径')
    def test_qwen_template_rewritten_on_windows(self):
        hooks = integrate.load_template(integrate.REPO / 'integrations/qwen/hooks.json')['hooks']
        entries = [c for gs in hooks.values() for g in gs for c in g['hooks']]
        self.assertTrue(entries)
        for e in entries:
            self.assertTrue(e['command'].startswith(integrate.win_arg(Path(sys.executable)) + ' '))  # 换成本机 Python
            self.assertNotIn('$HOME', e['command'])          # 换成绝对路径
            self.assertIn('crosspet-hook.py', e['command'])
            self.assertTrue(e['command'].endswith(' qwen'))  # 角色参数不能被改写吃掉
        self.assertEqual(len({e['command'] for e in entries}), 1)
    def test_qwen_install_is_idempotent_and_reversible(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'settings.json'
            other = {'type': 'command', 'command': 'echo keep-me'}
            integrate.save_json(p, {'theme': 'dark', 'hooks': {'Stop': [{'hooks': [other]}]}})
            integrate.merge_hooks(p, integrate.REPO / 'integrations/qwen/hooks.json')
            first = integrate.load_json(p)
            integrate.merge_hooks(p, integrate.REPO / 'integrations/qwen/hooks.json')
            self.assertEqual(first, integrate.load_json(p))                  # 重复接入不叠加
            self.assertEqual(first['hooks']['Stop'][0]['hooks'], [other])     # 同一事件下别人的钩子不动
            self.assertTrue(integrate.has_hooks(p))
            integrate.remove_hooks(p)
            self.assertEqual(integrate.load_json(p), {'theme': 'dark', 'hooks': {'Stop': [{'hooks': [other]}]}})
    def test_qwen_registered_as_target(self):
        self.assertIn('qwen', integrate.TARGETS)
        self.assertEqual(integrate.SEEN_KEY['qwen'], 'qwen')
        self.assertEqual(integrate.QWEN_SETTINGS.name, 'settings.json')
        self.assertEqual(integrate.QWEN_SETTINGS.parent.name, '.qwen')
    def test_qwen_template_covers_events_the_hook_understands(self):
        # 模板里的事件名必须都是钩子脚本认得的，否则加了也只会走到兜底分支
        hook = (integrate.REPO / 'integrations/crosspet-hook.py').read_text(encoding='utf-8')
        for event in integrate.load_json(integrate.REPO / 'integrations/qwen/hooks.json')['hooks']:
            self.assertIn(f'"{event}"', hook, event)

    # Kimi Code：钩子写在 ~/.kimi-code/config.toml 的 [[hooks]] 表里，CrossPet 的条目整段夹在两行标记之间
    KIMI_TOML = 'default_model = "kimi-code/k3"\n\n[[hooks]]\nevent = "Notification"\ncommand = "terminal-notifier -message done"\n\n[thinking]\nenabled = true\n'
    def run_kimi(self, tmp, install, text=None):
        home = Path(tmp) / '.kimi-code'; home.mkdir(exist_ok=True)
        (home / 'device_id').write_text('x')   # Kimi Code 自己的文件：只有 config.toml 不算装过
        cfg = home / 'config.toml'
        if text is not None:
            cfg.write_text(text, encoding='utf-8')
        with mock.patch.object(integrate, 'KIMI_HOME', home), mock.patch.object(integrate, 'KIMI_CONFIG', cfg), \
             contextlib.redirect_stdout(io.StringIO()):
            integrate.kimi(install)
        return cfg.read_text(encoding='utf-8') if cfg.exists() else None
    def test_kimi_install_is_idempotent_and_reversible(self):
        import tomllib
        with tempfile.TemporaryDirectory() as tmp:
            first = self.run_kimi(tmp, True, self.KIMI_TOML)
            self.assertEqual(self.run_kimi(tmp, True), first)                      # 重复接入不叠加
            data = tomllib.loads(first)                                            # 还是合法的 TOML
            ours = [h for h in data['hooks'] if 'crosspet-hook.py' in h['command']]
            self.assertEqual({h['event'] for h in ours}, set(integrate.KIMI_EVENTS))
            for h in data['hooks']:
                self.assertLessEqual(set(h), {'event', 'matcher', 'command', 'timeout'})   # 多一个字段整个配置读不进去
            self.assertTrue(all(h['command'].endswith(' kimi') for h in ours))
            self.assertIn({'event': 'Notification', 'command': 'terminal-notifier -message done'}, data['hooks'])   # 别人的不动
            self.assertEqual(data['thinking'], {'enabled': True})
            self.assertEqual(self.run_kimi(tmp, False).strip(), self.KIMI_TOML.strip())   # 撤销后和原来一样
    def test_kimi_uninstall_removes_entries_without_markers(self):
        # 标记被人删了、只剩条目：按 [[hooks]] 表认出命令里有 crosspet-hook.py 的
        loose = self.KIMI_TOML + '\n[[hooks]]\nevent = "Stop"\ncommand = \'python3 "x/crosspet-hook.py" kimi\'\n'
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(self.run_kimi(tmp, False, loose).strip(), self.KIMI_TOML.strip())
    def test_kimi_uninstall_leaves_untouched_config_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(self.run_kimi(tmp, False, self.KIMI_TOML), self.KIMI_TOML)
            self.assertEqual(list((Path(tmp) / '.kimi-code').glob('*.bak-crosspet-*')), [])   # 没改就不备份
    def test_kimi_skips_when_not_installed(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / '.kimi-code'
            with mock.patch.object(integrate, 'KIMI_HOME', home), mock.patch.object(integrate, 'KIMI_CONFIG', home / 'config.toml'), \
                 contextlib.redirect_stdout(io.StringIO()):
                integrate.kimi(True)
            self.assertFalse(home.exists())
    def test_kimi_registered_and_events_known_to_hook(self):
        self.assertIn('kimi', integrate.TARGETS)
        self.assertEqual(integrate.SEEN_KEY['kimi'], 'kimi')
        hook = (integrate.REPO / 'integrations/crosspet-hook.py').read_text(encoding='utf-8')
        for event in integrate.KIMI_EVENTS:
            self.assertIn(f'"{event}"', hook, event)
    def test_toml_str_quotes(self):
        import tomllib
        for value in ['python3 "$HOME/a b/crosspet-hook.py" kimi', "C:/it's/py.exe x kimi", 'C:\\x\\y "z"']:
            self.assertEqual(tomllib.loads('v = ' + integrate.toml_str(value))['v'], value)


class WindowsClaudeExecFormTests(unittest.TestCase):
    # #45：Windows 上 Claude Code 的钩子写成 exec 形式（command 是随包 Python、args 是参数），不经过命令行壳；
    # 在 macOS 上假装成 Windows 跑一遍 load_template（os 换成只把 name 改成 nt 的代理，SUPPORT 指到临时目录）
    class _Os:
        name = 'nt'
        def __getattr__(self, k): return getattr(os, k)
    def _template(self, tmp):
        with mock.patch.object(integrate, 'os', self._Os()), mock.patch.object(integrate, 'SUPPORT', Path(tmp)):
            return integrate.load_template(integrate.REPO / 'integrations/claude-code/hooks.json')
    def test_claude_hooks_are_exec_form(self):
        with tempfile.TemporaryDirectory() as tmp:
            hooks = [h for groups in self._template(tmp)['hooks'].values() for g in groups for h in g['hooks']]
            self.assertTrue(hooks)
            for h in hooks:
                self.assertEqual(h['command'], str(Path(sys.executable)))
                self.assertEqual(h['args'], ['-I', str(Path(tmp) / integrate.MARK), 'claude'])
                self.assertNotIn('onFailure', h)   # 不写：默认就不拦，旧版 Claude Code 也不认这个字段
                self.assertEqual(h['timeout'], 5)
    def test_exec_form_entries_are_ours_and_user_hooks_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            ours = self._template(tmp)['hooks']['PreToolUse'][0]
            mine = {'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': 'node', 'args': ['check.js']}]}
            mixed = {'matcher': '*', 'hooks': [ours['hooks'][0], {'type': 'command', 'command': 'echo hi'}]}
            kept = integrate.without_ours([mine, ours, mixed])
            self.assertEqual(kept, [mine, {'matcher': '*', 'hooks': [{'type': 'command', 'command': 'echo hi'}]}])


class SeenTests(unittest.TestCase):
    # #44：增强版 mod 的心跳写成了带引号的字符串（"1793979559"），诊断读不出、一直「没有记录」；旧 mod 写的文件也要认
    def test_seen_reads_plain_and_quoted(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(integrate, 'STATE_DIR', Path(tmp)):
            now = int(integrate.time.time()) if hasattr(integrate, 'time') else int(__import__('time').time())
            (Path(tmp) / 'seen-claude-mod').write_text(f'"{now}"')
            self.assertNotEqual(integrate.seen('claude-mod'), '没有记录')
            (Path(tmp) / 'seen-claude-mod').write_text(str(now))
            self.assertNotEqual(integrate.seen('claude-mod'), '没有记录')


class CursorIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='crosspet-cursor-integration-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.home = self.root / 'profile'
        self.target = self.home / '.cursor/hooks.json'
        self.target.parent.mkdir(parents=True)
        (self.target.parent / 'user-settings.json').write_text('{}', encoding='utf-8')
        self.support = self.root / 'data'
        patch = mock.patch.multiple(integrate, HOME=self.home, CURSOR_HOOKS=self.target, SUPPORT=self.support)
        patch.start()
        self.addCleanup(patch.stop)

    def run_merge(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            success = integrate.merge_cursor_hooks(self.target)
        return success, out.getvalue()

    def ours(self, data):
        return [entry for entries in data['hooks'].values() if isinstance(entries, list)
                for entry in entries if integrate.cursor_ours(entry)]

    def test_default_install_idempotent_and_uninstall_preserves_user_hooks(self):
        other = {'type': 'command', 'command': 'echo keep-user-hook'}
        original = {'version': 1, 'userOption': {'keep': True}, 'hooks': {'stop': [other], 'userEmptyEvent': []}}
        integrate.save_json(self.target, original)
        self.assertTrue(self.run_merge()[0])
        first = integrate.load_json(self.target)
        # 默认不带角色参数：认不出的模型由当前角色来演
        self.assertEqual({integrate.cursor_character(entry) for entry in self.ours(first)}, {''})
        self.assertEqual(len(self.ours(first)), 13)
        self.assertTrue(self.run_merge()[0])
        self.assertEqual(integrate.load_json(self.target), first)
        integrate.remove_cursor_hooks(self.target)
        self.assertEqual(integrate.load_json(self.target), original)

    def test_refresh_preserves_custom_role_and_cleans_retired_events(self):
        command = 'python3 "old/crosspet-cursor-bridge.py" grok'
        other = {'type': 'command', 'command': 'echo keep-user-hook'}
        integrate.save_json(self.target, {'version': 1, 'hooks': {
            'stop': [{'command': command}, other],
            'retired': [{'command': command}],
            'retiredMixed': [{'command': command}, other],
        }})
        with contextlib.redirect_stdout(io.StringIO()):
            integrate.cursor(True)
        first = integrate.load_json(self.target)
        self.assertNotIn('retired', first['hooks'])
        self.assertEqual(first['hooks']['retiredMixed'], [other])
        self.assertIn(other, first['hooks']['stop'])
        self.assertEqual({integrate.cursor_character(entry) for entry in self.ours(first)}, {'grok'})
        self.assertEqual(len(self.ours(first)), 13)
        self.assertTrue((self.support / integrate.CURSOR_MARK).exists())
        self.assertTrue(self.run_merge()[0])
        self.assertEqual(integrate.load_json(self.target), first)

    def test_conflicting_roles_leave_config_and_bridge_untouched(self):
        integrate.save_json(self.target, {'version': 1, 'hooks': {
            'stop': [{'command': 'python crosspet-cursor-bridge.py grok'}],
            'sessionStart': [{'command': 'python crosspet-cursor-bridge.py gpt'}],
        }})
        before = self.target.read_bytes()
        success, output = self.run_merge()
        self.assertFalse(success)
        self.assertIn('保留原配置', output)
        self.assertEqual(self.target.read_bytes(), before)
        self.assertFalse((self.support / integrate.CURSOR_MARK).exists())
        self.assertFalse(list(self.target.parent.glob('*.bak-crosspet-*')))

    def test_unrecognized_command_leaves_config_untouched(self):
        integrate.save_json(self.target, {'version': 1, 'hooks': {'stop': [
            {'command': 'python crosspet-cursor-bridge.py grok --custom-wrapper'}]}})
        before = self.target.read_bytes()
        success, output = self.run_merge()
        self.assertFalse(success)
        self.assertIn('无法识别', output)
        self.assertEqual(self.target.read_bytes(), before)

    def test_quoted_unicode_character_and_missing_argument(self):
        for role in ('"魅魔娘"', "'grok'", ''):
            with self.subTest(role=role):
                integrate.save_json(self.target, {'version': 1, 'hooks': {'stop': [
                    {'command': f'python "old/crosspet-cursor-bridge.py" {role}'}]}})
                self.assertTrue(self.run_merge()[0])
                expected = role.strip('"\'')
                self.assertEqual({integrate.cursor_character(entry) for entry in self.ours(integrate.load_json(self.target))}, {expected})

    def test_grouped_hook_format_is_diagnosed_without_partial_changes(self):
        integrate.save_json(self.target, {'version': 1, 'hooks': {
            'stop': [{'hooks': [{'command': 'echo keep-grouped'}]}]}})
        before = self.target.read_bytes()
        success, output = self.run_merge()
        self.assertFalse(success)
        self.assertIn('不是 Cursor', output)
        self.assertEqual(self.target.read_bytes(), before)
        self.assertFalse((self.support / integrate.CURSOR_MARK).exists())

    def test_cli_refresh_twice_uses_temp_profile_and_preserves_grok(self):
        other = {'command': 'echo keep-user-hook', 'type': 'command'}
        integrate.save_json(self.target, {'version': 1, 'userOption': True, 'hooks': {
            'stop': [{'command': 'python3 "old/crosspet-cursor-bridge.py" grok'}, other]}})
        env = dict(os.environ, HOME=str(self.home), USERPROFILE=str(self.home),
                   LOCALAPPDATA=str(self.home / 'AppData/Local'), APPDATA=str(self.home / 'AppData/Roaming'),
                   CROSSPET_DATA_DIR=str(self.support), CROSSPET_STATE_DIR=str(self.support / 'state'),
                   CODEX_HOME=str(self.home / '.codex'), CLAUDE_CONFIG_DIR=str(self.home / '.claude'),
                   DSH_PROFILE_DIR=str(self.home / 'dsh-profile'), DSH_HOME=str(self.home / 'dsh'),
                   WORKBUDDY_CONFIG_DIR=str(self.home / '.workbuddy'), HERMES_HOME=str(self.home / '.hermes'),
                   PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1')
        first = None
        for _ in range(2):
            result = subprocess.run([sys.executable, '-B', str(integrate.REPO / 'tools/integrate.py'), 'refresh'],
                                    env=env, capture_output=True, text=True, encoding='utf-8', timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, '')
            self.assertIn('更新 cursor', result.stdout)
            after = integrate.load_json(self.target)
            self.assertEqual({integrate.cursor_character(entry) for entry in self.ours(after)}, {'grok'})
            self.assertEqual(len(self.ours(after)), 13)
            self.assertIn(other, after['hooks']['stop'])
            self.assertTrue(after['userOption'])
            if first is not None:
                self.assertEqual(after, first)
            first = after

# Harness 加的服务商写在文件末尾，也就是我们那段的两行注释中间
DSH_USER = """- insert:
    - id: hello
      name: '@deepseek-ai/hello'
"""
DSH_PROVIDER = """- insert:
    - id: provider-siliconflow
      name: '@deepseek-ai/dsh-provider-openai'
      config:
        baseURL: https://api.siliconflow.cn/v1
        apiKey: sk-xxx
"""
DSH_OURS_ONLY = "    - id: crosspet\n      name: '@local/dsh-plugin-crosspet'\n"


class OpenCodeIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='crosspet-opencode-integration-')
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name) / 'config'
        self.plugin = self.home / 'plugins/crosspet.js'
        patch = mock.patch.multiple(integrate, OPENCODE_HOME=self.home, OPENCODE_PLUGIN=self.plugin)
        patch.start()
        self.addCleanup(patch.stop)

    def run_target(self, install):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            integrate.opencode(install)
        return out.getvalue()

    def test_skips_when_opencode_has_not_run(self):
        self.assertIn('没找到 OpenCode', self.run_target(True))
        self.assertFalse(self.home.exists())
        self.assertFalse(integrate.has_opencode())

    def test_install_is_idempotent_and_uninstall_only_removes_ours(self):
        self.home.mkdir(parents=True)
        other = self.home / 'plugins/other.js'
        other.parent.mkdir()
        other.write_text('export default {}\n', encoding='utf-8')
        config = self.home / 'opencode.json'
        config.write_text('{"model":"keep/me"}\n', encoding='utf-8')
        self.run_target(True)
        self.assertTrue(integrate.has_opencode())
        self.assertEqual(self.plugin.read_bytes(), (integrate.REPO / 'integrations/opencode/crosspet.js').read_bytes())
        first = self.plugin.read_bytes()
        self.run_target(True)
        self.assertEqual(self.plugin.read_bytes(), first)
        self.assertEqual(other.read_text(encoding='utf-8'), 'export default {}\n')
        self.assertEqual(config.read_text(encoding='utf-8'), '{"model":"keep/me"}\n')
        self.assertIn('opencode', integrate.installed())
        self.run_target(False)
        self.assertFalse(self.plugin.exists())
        self.assertTrue(other.exists())
        self.assertTrue(config.exists())
        self.assertFalse(integrate.has_opencode())

    def test_uninstall_leaves_unrelated_same_name_plugin(self):
        self.plugin.parent.mkdir(parents=True)
        self.plugin.write_text('// user-owned plugin\n', encoding='utf-8')
        self.run_target(False)
        self.assertEqual(self.plugin.read_text(encoding='utf-8'), '// user-owned plugin\n')
        self.assertFalse(integrate.has_opencode())

    def test_registered_with_heartbeat_and_diagnostics(self):
        self.assertIn('opencode', integrate.TARGETS)
        self.assertEqual(integrate.SEEN_KEY['opencode'], 'opencode')
        self.home.mkdir(parents=True)
        self.run_target(True)
        with mock.patch.object(integrate, 'STATE_DIR', Path(self.tmp.name) / 'state'):
            text = integrate.diagnose()
        self.assertIn('[OpenCode]', text)
        self.assertIn('crosspet.js', text)


class GrokIntegrationTests(unittest.TestCase):
    """Grok Build：CrossPet 单独占 ~/.grok/hooks/crosspet.json，接入写它、撤销删它，用户自己的钩子文件不动"""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='crosspet-grok-integration-')
        self.addCleanup(self.tmp.cleanup)
        self.grok_home = Path(self.tmp.name) / '.grok'
        patch = mock.patch.multiple(integrate, GROK_HOME=self.grok_home, GROK_HOOKS=self.grok_home / 'hooks/crosspet.json')
        patch.start()
        self.addCleanup(patch.stop)

    def run_target(self, install):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            integrate.grok(install)
        return out.getvalue()

    def test_skips_when_grok_build_is_not_installed(self):
        self.assertIn('没找到 Grok Build', self.run_target(True))
        self.assertFalse(self.grok_home.exists())
        self.assertFalse(integrate.has_grok())

    def test_install_idempotent_and_uninstall_keeps_user_hooks(self):
        (self.grok_home / 'hooks').mkdir(parents=True)
        (self.grok_home / 'config.toml').write_text('', encoding='utf-8')
        mine = self.grok_home / 'hooks/my-guard.json'
        mine.write_text('{"hooks": {"PreToolUse": []}}', encoding='utf-8')
        self.run_target(True)
        first = integrate.load_json(integrate.GROK_HOOKS)
        self.assertTrue(integrate.has_grok())
        self.assertIn('StopCancelled', first['hooks'])
        self.assertTrue(all(g['hooks'][0]['command'].endswith(' grok') for groups in first['hooks'].values() for g in groups))
        self.run_target(True)
        self.assertEqual(integrate.load_json(integrate.GROK_HOOKS), first)
        self.run_target(False)
        self.assertFalse(integrate.GROK_HOOKS.exists())
        self.assertFalse(integrate.has_grok())
        self.assertEqual(mine.read_text(encoding='utf-8'), '{"hooks": {"PreToolUse": []}}')


class DeepSeekPatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.profile = root / 'profile'
        self.profile.mkdir()
        self.patch = self.profile / 'cordis.patch.yml'
        integrate.save_json(self.profile / 'package.json', {'dependencies': {}})
        self.saved = {k: getattr(integrate, k) for k in ('DSH_PROFILE', 'DSH_PLUGIN_DIR', 'DSH_RESTORED')}
        integrate.DSH_PROFILE = self.profile
        integrate.DSH_PLUGIN_DIR = root / 'support/dsh-plugin-crosspet'
        integrate.DSH_RESTORED = root / 'support/dsh-patch-restored'

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(integrate, k, v)
        self.tmp.cleanup()

    def run_dsh(self, install):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            integrate.deepseek(install)
        return out.getvalue()

    def test_install_never_writes_an_invalid_plugin_version(self):
        # package.json 的版本号写错，Harness 装别的插件时会被拦住（1.3.8-beta.2 的 "1.3.8.1"）
        self.run_dsh(True)
        ver = integrate.load_json(integrate.DSH_PLUGIN_DIR / 'package.json')['version']
        self.assertRegex(ver, integrate.SEMVER)
        self.assertTrue(integrate.valid_version('1.3.9'))
        for bad in ('1.3.8.1', '1.3', 'v1.3.9', ''):
            self.assertFalse(integrate.valid_version(bad), bad)

    def test_strip_keeps_provider_between_markers(self):
        text = DSH_USER + integrate.DSH_BLOCK.replace(integrate.DSH_BLOCK_END, DSH_PROVIDER + integrate.DSH_BLOCK_END)
        self.assertEqual(integrate.dsh_strip(text), DSH_USER + DSH_PROVIDER)

    def test_strip_keeps_provider_hung_under_our_insert(self):
        text = DSH_USER + integrate.DSH_BLOCK.replace(DSH_OURS_ONLY, DSH_OURS_ONLY + DSH_PROVIDER.split('\n', 1)[1])
        self.assertEqual(integrate.dsh_strip(text), DSH_USER + DSH_PROVIDER)
        text = DSH_USER + integrate.DSH_BLOCK.replace(DSH_OURS_ONLY, DSH_PROVIDER.split('\n', 1)[1] + DSH_OURS_ONLY)
        self.assertEqual(integrate.dsh_strip(text), DSH_USER + DSH_PROVIDER)

    def test_strip_plain_block_restores_original(self):
        self.assertEqual(integrate.dsh_strip(DSH_USER + integrate.DSH_BLOCK), DSH_USER)
        self.assertEqual(integrate.dsh_strip(integrate.DSH_BLOCK), '')

    def test_refresh_and_uninstall_keep_provider(self):
        self.patch.write_text(DSH_USER, encoding='utf-8')
        self.run_dsh(True)
        installed = self.patch.read_text(encoding='utf-8')
        self.assertEqual(installed, DSH_USER + integrate.DSH_BLOCK)
        # 用户在 Harness 里加了服务商：落在我们两行注释中间
        self.patch.write_text(installed.replace(integrate.DSH_BLOCK_END, DSH_PROVIDER + integrate.DSH_BLOCK_END), encoding='utf-8')
        self.run_dsh(True)   # 更新时的刷新
        self.run_dsh(True)
        after = self.patch.read_text(encoding='utf-8')
        self.assertEqual(after, DSH_USER + DSH_PROVIDER + integrate.DSH_BLOCK)
        self.run_dsh(False)
        self.assertEqual(self.patch.read_text(encoding='utf-8'), DSH_USER + DSH_PROVIDER)

    def test_restore_provider_lost_by_old_version_once(self):
        # 1.3.0 刷新前留下的备份里，服务商夹在我们两行注释中间；刷新后文件里没了
        bak = self.profile / 'cordis.patch.yml.bak-crosspet-20261010-205029'
        bak.write_text(DSH_USER + integrate.DSH_BLOCK.replace(integrate.DSH_BLOCK_END, DSH_PROVIDER + integrate.DSH_BLOCK_END), encoding='utf-8')
        self.patch.write_text(DSH_USER + integrate.DSH_BLOCK, encoding='utf-8')
        out = self.run_dsh(True)
        self.assertIn('找回 1 条', out)
        self.assertEqual(self.patch.read_text(encoding='utf-8'), DSH_USER + DSH_PROVIDER + integrate.DSH_BLOCK)
        # 只找回一次：之后用户自己删掉的不再加回来
        self.patch.write_text(DSH_USER + integrate.DSH_BLOCK, encoding='utf-8')
        self.run_dsh(True)
        self.assertEqual(self.patch.read_text(encoding='utf-8'), DSH_USER + integrate.DSH_BLOCK)

    def test_restore_skips_provider_user_already_readded(self):
        bak = self.profile / 'cordis.patch.yml.bak-crosspet-20261010-205029'
        bak.write_text(DSH_USER + integrate.DSH_BLOCK.replace(integrate.DSH_BLOCK_END, DSH_PROVIDER + integrate.DSH_BLOCK_END), encoding='utf-8')
        readded = DSH_PROVIDER.replace('sk-xxx', 'sk-new')
        self.patch.write_text(DSH_USER + integrate.DSH_BLOCK + readded, encoding='utf-8')
        out = self.run_dsh(True)
        self.assertNotIn('找回', out)
        self.assertEqual(self.patch.read_text(encoding='utf-8'), DSH_USER + readded + integrate.DSH_BLOCK)


if __name__ == '__main__':
    unittest.main()
