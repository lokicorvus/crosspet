# 钩子脚本的回归测试：python tests/hook_test.py
# 用沙箱数据目录跑真的 crosspet-hook.py，只看它写出了什么、花了多久、有没有报错，不碰本机任何配置
#
# 多模型宿主（claude / gpt / qwen）按模型选角色、模型表与会话状态分开存，以及角色还没画立绘时的降级。
# #19 的 stdin 读取回归测试在上游的 tests/hook_stdin_test.py 里，这里不再重复一份。
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / 'integrations/crosspet-hook.py'


class HookModelHostTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name) / 'data'
        self.state = Path(self.tmp.name) / 'state'
        self.data.mkdir()
        self.state.mkdir()
    def tearDown(self):
        self.tmp.cleanup()
    def add_character(self, cid, idle=True):
        d = self.data / 'characters' / cid
        d.mkdir(parents=True)
        (d / 'character.json').write_text('{"name": "X"}', encoding='utf-8')
        if idle:
            (d / 'idle.webp').write_bytes(b'x')   # installed() 只看这张在不在，内容无所谓
        return d
    def fire(self, character, event):
        env = dict(os.environ, CROSSPET_DATA_DIR=str(self.data), CROSSPET_STATE_DIR=str(self.state))
        p = subprocess.run([sys.executable, str(HOOK), character], input=json.dumps(event).encode(),
                           capture_output=True, env=env)
        out = p.stderr.decode('utf-8', 'replace')
        self.assertNotIn('Traceback', out)
        self.assertEqual(p.returncode, 0, out)
        return p
    def read(self, name):
        try:
            return json.loads((self.state / name).read_text(encoding='utf-8'))
        except FileNotFoundError:
            return None

    # 宿主名同时也是角色名的多模型宿主（qwen）：<名字>-sessions.json 归多会话状态用，
    # 模型必须另记 <名字>-models.json。混在一起时第二条事件会把会话状态当模型名读，直接崩
    def test_named_multi_model_host_keeps_models_and_sessions_apart(self):
        self.add_character('qwen')
        self.fire('qwen', {'hook_event_name': 'SessionStart', 'session_id': 's1', 'model': 'qwen3.8-max', 'source': 'startup'})
        self.assertEqual(self.read('qwen-host.json')['character'], 'qwen')
        # 第二条事件不带模型名：要按会话记住的模型继续判角色，而不是崩掉
        self.fire('qwen', {'hook_event_name': 'PreToolUse', 'session_id': 's1', 'tool_name': 'bash'})
        self.assertEqual(self.read('qwen-host.json')['character'], 'qwen')
        self.assertEqual(self.read('qwen-host.json')['model'], 'qwen3.8-max')
        self.assertEqual(self.read('qwen-state.json')['pose'], 'running')
        # 两个文件各管各的：会话状态是 {pose,event,ts}，模型表是 {会话: 模型名}
        self.assertIn('pose', self.read('qwen-sessions.json')['s1'])
        self.assertEqual(self.read('qwen-models.json'), {'s1': 'qwen3.8-max'})
    def test_named_multi_model_host_survives_many_events(self):
        # 崩在「第二条事件」上，所以多来几条
        self.add_character('qwen')
        self.fire('qwen', {'hook_event_name': 'SessionStart', 'session_id': 's1', 'model': 'qwen3.8-max', 'source': 'startup'})
        for event in ('PreToolUse', 'PostToolUse', 'PreToolUse', 'Stop', 'UserPromptSubmit'):
            self.fire('qwen', {'hook_event_name': event, 'session_id': 's1', 'tool_name': 'read_file'})
    # 用仓库里真实的 characters/qwen/ 验证交付物，而不只依赖 add_character 的占位图。
    # 立绘和接入是分开提交的：只有接入、还没合入素材时，这里就没有可读的角色文件，跳过而不是失败。
    @unittest.skipUnless((REPO / 'characters' / 'qwen' / 'idle.webp').exists(),
                         '需要 characters/qwen/ 里的真实立绘')
    def test_bundled_qwen_character_is_selected(self):
        source = REPO / 'characters' / 'qwen'
        target = self.data / 'characters' / 'qwen'
        target.mkdir(parents=True)
        shutil.copy2(source / 'character.json', target / 'character.json')
        shutil.copy2(source / 'idle.webp', target / 'idle.webp')
        self.fire('qwen', {'hook_event_name': 'SessionStart', 'session_id': 's1', 'model': 'qwen3.8-max'})
        self.assertEqual(self.read('qwen-host.json')['character'], 'qwen')
        self.assertEqual(self.read('qwen-state.json')['pose'], 'idle')
    def test_parallel_qwen_sessions_keep_each_model(self):
        # 并行钩子不能争用同一个临时文件，也不能在读旧表、写新表时丢掉别的会话。
        self.add_character('qwen')
        def start(i):
            self.fire('qwen', {'hook_event_name': 'SessionStart', 'session_id': f's{i}', 'model': f'qwen3.8-max-{i}'})
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(start, range(8)))
        self.assertEqual(self.read('qwen-models.json'), {f's{i}': f'qwen3.8-max-{i}' for i in range(8)})
    def test_model_without_character_falls_back_to_current(self):
        # 目标安装目录没有立绘时：别报错，交给当前角色来演
        self.fire('qwen', {'hook_event_name': 'SessionStart', 'session_id': 's1', 'model': 'qwen3.8-max', 'source': 'startup'})
        self.assertIsNone(self.read('qwen-host.json')['character'])
        self.assertEqual(self.read('current-state.json')['event'], 'SessionStart')
    def test_other_provider_in_qwen_code_maps_to_its_character(self):
        self.add_character('qwen')
        self.add_character('glm')
        self.fire('qwen', {'hook_event_name': 'SessionStart', 'session_id': 's1', 'model': 'glm-4.6', 'source': 'startup'})
        self.assertEqual(self.read('qwen-host.json')['character'], 'glm')
    # Qwen Code 的工具 id（来自它自带的 docs/features/hooks.md 和工具名常量）：常用的都要演对动作
    def test_qwen_code_tool_ids_map_to_poses(self):
        self.add_character('qwen')
        self.fire('qwen', {'hook_event_name': 'SessionStart', 'session_id': 's1', 'model': 'qwen3.8-max', 'source': 'startup'})
        expect = {'read_file': 'reading', 'grep_search': 'reading', 'glob': 'reading', 'list_directory': 'reading',
                  'zoom_image': 'reading', 'write_file': 'writing', 'edit': 'writing', 'run_shell_command': 'running',
                  'web_fetch': 'searching', 'web_search': 'searching', 'agent': 'delegating',
                  'ask_user_question': 'asking', 'image_gen': 'drawing'}
        got = {}
        for tool in expect:
            self.fire('qwen', {'hook_event_name': 'PreToolUse', 'session_id': 's1', 'tool_name': tool, 'tool_input': {}})
            got[tool] = self.read('qwen-state.json')['pose']
        self.assertEqual(got, expect)

    # 用千问账号登录时，Qwen Code 报的模型名是别名 coder-model（它的 QWEN_OAUTH_MODELS，实为 Qwen 3.7 Max），10-19 本机实测收到
    def test_qwen_oauth_alias_coder_model_is_qwen(self):
        self.add_character('qwen')
        self.fire('qwen', {'hook_event_name': 'SessionStart', 'session_id': 's1', 'model': 'coder-model', 'source': 'startup'})
        self.assertEqual(self.read('qwen-host.json')['character'], 'qwen')

    # 别的宿主里用 Grok 模型（OpenRouter 的 x-ai/grok-…、xAI 自家的 grok-…）时换成 Grok
    def test_grok_model_is_grok(self):
        self.add_character('qwen')
        self.add_character('grok')
        for sid, model in (('s1', 'grok-4.7'), ('s2', 'x-ai/grok-code-fast-2')):
            self.fire('qwen', {'hook_event_name': 'SessionStart', 'session_id': sid, 'model': model, 'source': 'startup'})
            self.assertEqual(self.read('qwen-host.json')['character'], 'grok', model)

    def test_session_start_writes_heartbeat(self):
        self.add_character('qwen')
        self.fire('qwen', {'hook_event_name': 'SessionStart', 'session_id': 's1', 'model': 'qwen3.8-max', 'source': 'startup'})
        self.assertTrue((self.state / 'seen-qwen').exists())



class HookGrokTests(unittest.TestCase):
    """Grok Build：字段是驼峰写法（sessionId / toolName / toolInput），每个钩子进程都带 GROK_HOOK_EVENT；
    它还会读 ~/.claude/settings.json 里的钩子，那边的 CrossPet 钩子会被它以 claude 的名义触发"""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.data, self.state, self.grok_home = root / 'data', root / 'state', root / 'grok'
        for d in (self.data, self.state, self.grok_home):
            d.mkdir()
        for cid in ('grok', 'claude'):
            c = self.data / 'characters' / cid
            c.mkdir(parents=True)
            (c / 'character.json').write_text('{}', encoding='utf-8')
            (c / 'idle.webp').write_bytes(b'x')
    def tearDown(self):
        self.tmp.cleanup()
    def fire(self, character, event, grok=True):
        env = dict(os.environ, CROSSPET_DATA_DIR=str(self.data), CROSSPET_STATE_DIR=str(self.state), GROK_HOME=str(self.grok_home))
        env.pop('GROK_HOOK_EVENT', None)
        if grok:
            env['GROK_HOOK_EVENT'] = 'pre_tool_use'
        p = subprocess.run([sys.executable, str(HOOK), character], input=json.dumps(event).encode(), capture_output=True, env=env)
        self.assertEqual(p.returncode, 0, p.stderr.decode('utf-8', 'replace'))
    def read(self, name):
        try:
            return json.loads((self.state / name).read_text(encoding='utf-8'))
        except FileNotFoundError:
            return None

    def test_camel_case_tools(self):
        for tool, pose in (('run_terminal_command', 'running'), ('read_file', 'reading'), ('search_replace', 'writing'), ('web_search', 'searching')):
            self.fire('grok', {'hook_event_name': 'PreToolUse', 'sessionId': 's1', 'toolName': tool, 'toolInput': {}})
            self.assertEqual(self.read('grok-state.json')['pose'], pose, tool)

    def test_stop_cancelled_is_interrupt(self):
        self.fire('grok', {'hook_event_name': 'StopCancelled', 'sessionId': 's1', 'reason': 'user_interrupt'})
        self.assertEqual((self.read('grok-state.json')['pose'], self.read('grok-state.json')['event']), ('surprised', 'Stop'))

    def test_shutdown_stop_after_session_end_is_ignored(self):
        # 10-27 实测：会话关闭（SessionEnd）后 Grok 还会补发一个 reason=shutdown 的 Stop，不能把睡着的她拉回「开心」
        self.fire('grok', {'hook_event_name': 'SessionEnd', 'session_id': 's1', 'reason': 'shutdown'})
        self.fire('grok', {'hook_event_name': 'Stop', 'session_id': 's1', 'reason': 'shutdown', 'stop_hook_active': False})
        self.assertEqual(self.read('grok-state.json')['pose'], 'sleeping')
        # 真正的一轮结束（reason=end_turn）照常开心
        self.fire('grok', {'hook_event_name': 'Stop', 'session_id': 's2', 'reason': 'end_turn', 'promptId': 'p1'})
        self.assertEqual(self.read('grok-state.json')['pose'], 'happy')

    def test_permission_notification_is_asking(self):
        self.fire('grok', {'hook_event_name': 'Notification', 'sessionId': 's1', 'notificationType': 'permission_prompt'})
        self.assertEqual(self.read('grok-state.json')['pose'], 'asking')

    def test_claude_hook_fired_by_grok_plays_grok(self):
        # 只接了 Claude 钩子、没单独接 Grok：Grok 干活时由 Grok 来演，不能当成 Claude
        self.fire('claude', {'hook_event_name': 'PreToolUse', 'sessionId': 's1', 'toolName': 'read_file', 'toolInput': {}})
        self.assertEqual(self.read('grok-state.json')['pose'], 'reading')
        self.assertIsNone(self.read('claude-state.json'))

    def test_claude_hook_fired_by_grok_is_dropped_when_grok_is_integrated(self):
        # 两边都接了：Grok 自己那份会演，Claude 那份丢掉，免得演两遍
        (self.grok_home / 'hooks').mkdir()
        (self.grok_home / 'hooks' / 'crosspet.json').write_text('{"hooks": {}}', encoding='utf-8')
        self.fire('claude', {'hook_event_name': 'PreToolUse', 'sessionId': 's1', 'toolName': 'read_file', 'toolInput': {}})
        self.assertIsNone(self.read('grok-state.json'))
        self.assertIsNone(self.read('claude-state.json'))

    def test_real_claude_is_untouched(self):
        self.fire('claude', {'hook_event_name': 'PreToolUse', 'session_id': 's1', 'tool_name': 'Read', 'tool_input': {}}, grok=False)
        self.assertEqual(self.read('claude-state.json')['pose'], 'reading')

if __name__ == '__main__':
    unittest.main()
