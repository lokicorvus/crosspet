# 钩子脚本的回归测试：python tests/hook_test.py
# 用沙箱数据目录跑真的 crosspet-hook.py，只看它写出了什么、花了多久、有没有报错，不碰本机任何配置
#
# 两组：
#   HookStdinTests       从 stdin 读事件：收全一份 JSON 就走，不等管道关闭（#19：等下去会挂住）
#   HookModelHostTests   多模型宿主按模型选角色，以及角色还没画立绘时的降级
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / 'integrations/crosspet-hook.py'
EVENT = {"hook_event_name": "PostToolUse", "session_id": "s", "tool_name": "Bash", "cwd": "/tmp"}


class HookStdinTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / 'state'
        self.data = Path(self.tmp.name) / 'data'
        self.state.mkdir()
        self.data.mkdir()
    def tearDown(self):
        self.tmp.cleanup()
    def run_hook(self, chunks=(), close_stdin=False, character='gpt', timeout=8, env=None):
        """chunks 依次写进 stdin；默认不关管道——就是 #19 里那个会挂住的场景"""
        p = subprocess.Popen([sys.executable, str(HOOK), character], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             env={**os.environ, 'CROSSPET_STATE_DIR': str(self.state),
                                  'CROSSPET_DATA_DIR': str(self.data), **(env or {})})
        started = time.monotonic()
        for chunk in chunks:
            p.stdin.write(chunk)
            p.stdin.flush()
        if close_stdin:
            p.stdin.close()
        try:
            p.wait(timeout=timeout)
            code = p.returncode
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
            code = None
        took = time.monotonic() - started
        err = p.stderr.read().decode('utf-8', 'replace')
        for stream in (p.stdin, p.stdout, p.stderr):
            try:
                stream.close()
            except Exception:
                pass
        self.assertNotIn('Traceback', err)
        return code, took, err
    def state_of(self, name='gpt-state.json'):
        try:
            return json.loads((self.state / name).read_text(encoding='utf-8'))
        except FileNotFoundError:
            return None
    def event_bytes(self, **overrides):
        # ensure_ascii=False：中文写成真的 UTF-8 字节，才能测「多字节字符被切成两段」
        return json.dumps({**EVENT, **overrides}, ensure_ascii=False).encode('utf-8')

    # 一条完整的事件 + 管道一直不关：必须照常处理并退出（#19 的核心）
    def test_complete_event_without_eof(self):
        code, took, _ = self.run_hook([self.event_bytes()])
        self.assertEqual(code, 0)
        self.assertLess(took, 3)
        self.assertEqual(self.state_of()['event'], 'PostToolUse')
    # 老行为不能坏：关掉管道照样处理
    def test_complete_event_with_eof(self):
        code, took, _ = self.run_hook([self.event_bytes()], close_stdin=True)
        self.assertEqual(code, 0)
        self.assertLess(took, 3)
        self.assertEqual(self.state_of()['event'], 'PostToolUse')
    # 空管道 + 不关：限时退出，不写状态（原来会一直挂着）
    def test_empty_stdin_gives_up(self):
        code, took, _ = self.run_hook([])
        self.assertEqual(code, 0)
        self.assertLess(took, 5)
        self.assertIsNone(self.state_of())
    # 管道关了但一个字节都没有
    def test_stdin_closed_without_data(self):
        code, took, _ = self.run_hook([], close_stdin=True)
        self.assertEqual(code, 0)
        self.assertLess(took, 3)
        self.assertIsNone(self.state_of())
    # 不是 JSON：不写状态，也别崩
    def test_invalid_json_writes_nothing(self):
        code, took, _ = self.run_hook([b'not json at all'])
        self.assertEqual(code, 0)
        self.assertIsNone(self.state_of())
    # 结尾的空白 / 换行要容忍（原来的 read() + json.loads 也容忍）
    def test_trailing_whitespace_is_tolerated(self):
        code, _, _ = self.run_hook([self.event_bytes() + b'\n'])
        self.assertEqual(code, 0)
        self.assertEqual(self.state_of()['event'], 'PostToolUse')
    # 但后面还有别的东西就当坏数据，不写状态——和原来的 json.loads 一样（它报 Extra data）
    def test_trailing_garbage_is_rejected(self):
        for payload in (self.event_bytes() + b'garbage', self.event_bytes() + b'{"x":1}'):
            with tempfile.TemporaryDirectory() as tmp:      # 每种情况用干净的状态目录
                self.state = Path(tmp) / 'state'
                self.state.mkdir()
                code, _, _ = self.run_hook([payload])
                self.assertEqual(code, 0)
                self.assertIsNone(self.state_of())
    # 事件里带中文，而且多字节字符被切成两段写：不能解码成乱码
    def test_split_utf8_is_reassembled(self):
        raw = self.event_bytes(tool_name='写文件')
        cut = raw.index('写'.encode('utf-8')) + 1        # 切在一个字的中间
        code, took, _ = self.run_hook([raw[:cut], raw[cut:]])
        self.assertEqual(code, 0)
        self.assertLess(took, 3)
        self.assertEqual(self.state_of()['tool'], '写文件')
    # 分两段写、中间有停顿：也要拼起来（第一段解析不出来时不能当失败）
    def test_event_split_across_writes(self):
        raw = self.event_bytes()
        half = len(raw) // 2
        code, _, _ = self.run_hook([raw[:half], raw[half:]])
        self.assertEqual(code, 0)
        self.assertEqual(self.state_of()['event'], 'PostToolUse')
    # 超过大小上限：当没收到，不写状态（用环境变量把上限压小来测）
    def test_oversized_input_is_ignored(self):
        raw = self.event_bytes(tool_input='x' * 500)
        code, took, _ = self.run_hook([raw], env={'CROSSPET_READ_LIMIT': '100'})
        self.assertEqual(code, 0)
        self.assertLess(took, 3)
        self.assertIsNone(self.state_of())
    # 读取期限可以用环境变量调：调小以后，空管道退得更快
    def test_read_timeout_is_configurable(self):
        _, took, _ = self.run_hook([], env={'CROSSPET_READ_TIMEOUT': '0.2'})
        self.assertLess(took, 1.5)
    # stdin 直接是空设备（等同没有输入）
    def test_devnull_stdin(self):
        p = subprocess.Popen([sys.executable, str(HOOK), 'gpt'], stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             env={**os.environ, 'CROSSPET_STATE_DIR': str(self.state), 'CROSSPET_DATA_DIR': str(self.data)})
        p.wait(timeout=8)
        code = p.returncode
        p.stdout.close()
        p.stderr.close()
        self.assertEqual(code, 0)
        self.assertIsNone(self.state_of())


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
    def test_session_start_writes_heartbeat(self):
        self.add_character('qwen')
        self.fire('qwen', {'hook_event_name': 'SessionStart', 'session_id': 's1', 'model': 'qwen3.8-max', 'source': 'startup'})
        self.assertTrue((self.state / 'seen-qwen').exists())


if __name__ == '__main__':
    unittest.main()
