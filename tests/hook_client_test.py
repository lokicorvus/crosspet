# 钩子按客户端记状态的回归测试：python3 -m unittest tests.hook_client_test -v
# 多桌宠按「角色 + 客户端」各站一只：会话条目带 client，另外写一份 <角色>@<客户端>-state.json。
# 设计见 docs/superpowers/specs/2026-10-31-multi-pets-design.md 第一节、第六节「接入层」。
# 和 tests/hook_test.py 一样用沙箱数据 / 状态目录跑真的 crosspet-hook.py，不碰本机配置，也不开桌宠
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOOK = REPO / 'integrations/crosspet-hook.py'
# 跑测试的终端本身可能就在 Claude Code / Grok Build 里，这些环境变量会被子进程继承，先清掉
INHERITED = ('CLAUDE_CODE_ENTRYPOINT', 'GROK_HOOK_EVENT', 'ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL')


class HookClientTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name) / 'data'
        self.state = Path(self.tmp.name) / 'state'
        self.data.mkdir()
        self.state.mkdir()
        (self.data / 'ai-autostart-off').write_text('test')   # 不让钩子顺手打开真的桌宠
        self.transcript = Path(self.tmp.name) / 'rollout.jsonl'   # Codex 的事件要有对话记录文件才算数
        self.transcript.write_text('')
    def tearDown(self):
        self.tmp.cleanup()
    def fire(self, host, event, entrypoint=None):
        env = {k: v for k, v in os.environ.items() if k not in INHERITED}
        env.update(CROSSPET_DATA_DIR=str(self.data), CROSSPET_STATE_DIR=str(self.state),
                   CODEX_HOME=str(Path(self.tmp.name, 'no-codex')))
        if entrypoint:
            env['CLAUDE_CODE_ENTRYPOINT'] = entrypoint
        p = subprocess.run([sys.executable, str(HOOK), host], input=json.dumps(event).encode(),
                           capture_output=True, env=env, timeout=10)
        out = p.stderr.decode('utf-8', 'replace')
        self.assertNotIn('Traceback', out)
        self.assertEqual(p.returncode, 0, out)
    def read(self, name):
        try:
            return json.loads((self.state / name).read_text(encoding='utf-8'))
        except FileNotFoundError:
            return None
    def ledger(self, integration):
        p = self.data / 'events' / f'{integration}.jsonl'
        return [json.loads(l) for l in p.read_text(encoding='utf-8').splitlines() if l.strip()]

    def test_claude_desktop_entrypoint(self):
        self.fire('claude', {'hook_event_name': 'PreToolUse', 'session_id': 's1', 'tool_name': 'Bash'},
                  entrypoint='claude-desktop')
        self.assertEqual(self.read('claude-sessions.json')['s1']['client'], 'claude-desktop')
        own = self.read('claude@claude-desktop-state.json')
        self.assertIsNotNone(own)
        self.assertEqual(own['pose'], 'running')
        self.assertEqual(own['client'], 'claude-desktop')
        # 原来的主文件照写，内容和按客户端那份一样（只是少个 client）
        main = self.read('claude-state.json')
        self.assertEqual(main['pose'], 'running')
        self.assertEqual({k: v for k, v in own.items() if k != 'client'}, main)
        # 事件记录每行带上 client，反馈排查用
        self.assertEqual(self.ledger('claude-hooks')[-1]['client'], 'claude-desktop')

    def test_claude_cli_default(self):
        self.fire('claude', {'hook_event_name': 'PreToolUse', 'session_id': 's1', 'tool_name': 'Bash'})
        self.assertEqual(self.read('claude-sessions.json')['s1']['client'], 'claude-cli')
        self.assertEqual(self.read('claude@claude-cli-state.json')['pose'], 'running')
        self.assertIsNone(self.read('claude@claude-desktop-state.json'))
        # 别的入口（IDE 插件、SDK）也算终端
        self.fire('claude', {'hook_event_name': 'PreToolUse', 'session_id': 's2', 'tool_name': 'Read'},
                  entrypoint='claude-vscode')
        self.assertEqual(self.read('claude-sessions.json')['s2']['client'], 'claude-cli')
        self.assertEqual(self.read('claude@claude-cli-state.json')['pose'], 'reading')
        self.assertEqual(self.ledger('claude-hooks')[-1]['client'], 'claude-cli')

    def test_codex_client(self):
        self.fire('gpt', {'hook_event_name': 'PreToolUse', 'session_id': 's1', 'turn_id': 'T1', 'cwd': '/tmp',
                          'model': 'gpt-test', 'tool_name': 'exec_command', 'transcript_path': str(self.transcript)})
        self.assertEqual(self.read('gpt@codex-state.json')['pose'], 'running')
        self.assertEqual(self.read('gpt@codex-state.json')['client'], 'codex')
        self.assertEqual(self.read('gpt-sessions.json')['s1']['client'], 'codex')
        self.assertEqual(self.ledger('codex')[-1]['client'], 'codex')

    def test_after_carried_per_client(self):
        # 同一客户端：工具开始后马上结束，按客户端那份也捎带上刚才的动作
        self.fire('claude', {'hook_event_name': 'PreToolUse', 'session_id': 'd1', 'tool_name': 'Read'},
                  entrypoint='claude-desktop')
        self.fire('claude', {'hook_event_name': 'PostToolUse', 'session_id': 'd1', 'tool_name': 'Read'},
                  entrypoint='claude-desktop')
        own = self.read('claude@claude-desktop-state.json')
        self.assertEqual((own['pose'], own.get('after')), ('thinking', 'reading'))

        # 两边交错：桌面开始读文件 → 终端开始跑命令（主文件被终端盖掉）→ 桌面工具结束。
        # 桌面那份要从自己的上一条捎带 reading；终端的 PostToolUse 只捎带自己的 running，不捎带桌面的
        self.fire('claude', {'hook_event_name': 'PreToolUse', 'session_id': 'd1', 'tool_name': 'Read'},
                  entrypoint='claude-desktop')
        self.fire('claude', {'hook_event_name': 'PreToolUse', 'session_id': 'c1', 'tool_name': 'Bash'})
        self.fire('claude', {'hook_event_name': 'PostToolUse', 'session_id': 'd1', 'tool_name': 'Read'},
                  entrypoint='claude-desktop')
        self.assertEqual(self.read('claude@claude-desktop-state.json').get('after'), 'reading')
        self.fire('claude', {'hook_event_name': 'PostToolUse', 'session_id': 'c1', 'tool_name': 'Bash'})
        cli = self.read('claude@claude-cli-state.json')
        self.assertEqual((cli['pose'], cli.get('after')), ('thinking', 'running'))
        # 桌面那份没被终端的事件改动
        self.assertEqual(self.read('claude@claude-desktop-state.json')['session'], 'd1')

    def test_other_client_post_does_not_carry_this_after(self):
        # 终端还没写过自己那份（退回读主文件）：主文件里是桌面的工具动作，会话不同，不能捎带
        self.fire('claude', {'hook_event_name': 'PreToolUse', 'session_id': 'd1', 'tool_name': 'Read'},
                  entrypoint='claude-desktop')
        self.fire('claude', {'hook_event_name': 'PostToolUse', 'session_id': 'c1', 'tool_name': 'Bash'})
        cli = self.read('claude@claude-cli-state.json')
        self.assertEqual(cli['pose'], 'thinking')
        self.assertNotIn('after', cli)


if __name__ == '__main__':
    unittest.main()
