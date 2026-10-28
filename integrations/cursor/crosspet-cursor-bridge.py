"""Cursor observer hooks -> the CrossPet character for the model each conversation uses."""
import contextlib
import ctypes
import hashlib
import json
import os
from pathlib import Path
import sys
import time

if os.name == 'nt':
    import msvcrt
else:
    import fcntl
    import select

# 每条事件都带 Cursor 里选的模型（model / model_id）：按它换成对应的角色，和 crosspet-hook.py 的多模型宿主一样。
# 认不出的模型（Cursor 自家的 Composer、Auto……）用接入时指定的角色（命令末尾的参数），没指定就由当前角色来演
FALLBACK = sys.argv[1] if len(sys.argv) > 1 else None

# Same folders as crosspet-hook.py and the shells: the macOS pet reads /tmp/crosspet.
if os.name == 'nt':
    ROOT = Path(os.environ.get('CROSSPET_DATA_DIR') or Path(os.environ['LOCALAPPDATA']) / 'CrossPet')
    STATE = Path(os.environ.get('CROSSPET_STATE_DIR') or ROOT / 'state')
else:
    ROOT = Path(os.environ.get('CROSSPET_DATA_DIR') or Path.home() / 'Library/Application Support/CrossPet')
    STATE = Path(os.environ.get('CROSSPET_STATE_DIR') or '/tmp/crosspet')
BIG_JOB_TOOLS = 8  # Same as crosspet-hook.py: a turn with this many tools ends 'proud'.
# Poses that mean a conversation is not working right now.
RESTING = ('idle', 'happy', 'proud', 'oops', 'surprised')
OBSERVERS = ('sessionStart', 'sessionEnd', 'beforeSubmitPrompt', 'postToolUse', 'postToolUseFailure',
             'afterShellExecution', 'afterMCPExecution', 'afterFileEdit',
             'afterAgentThought', 'afterAgentResponse', 'subagentStop', 'preCompact', 'stop')


def read_event():
    """Parse one complete UTF-8 JSON object without waiting for pipe EOF."""
    if os.name != 'nt':
        return read_event_posix()
    import msvcrt
    from ctypes import wintypes
    handle = msvcrt.get_osfhandle(sys.stdin.fileno())
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    available = wintypes.DWORD()
    buffer = b''
    end = time.monotonic() + 0.6
    while time.monotonic() < end and len(buffer) < 4 * 1024 * 1024:
        ok = kernel.PeekNamedPipe(wintypes.HANDLE(handle), None, 0, None, ctypes.byref(available), None)
        if not ok:
            if ctypes.get_last_error() == 109:
                break
            chunk = os.read(sys.stdin.fileno(), 65536)
        elif available.value:
            chunk = os.read(sys.stdin.fileno(), min(available.value, 65536))
        else:
            time.sleep(.005)
            continue
        if not chunk:
            break
        buffer += chunk
        if buffer.rstrip().endswith(b'}'):
            try:
                return json.loads(buffer.decode('utf-8-sig'))
            except (ValueError, UnicodeDecodeError):
                pass
    return json.loads(buffer.decode('utf-8-sig'))


def read_event_posix():
    """macOS: the same read, waiting with select instead of PeekNamedPipe."""
    fd = sys.stdin.fileno()
    buffer = b''
    end = time.monotonic() + 0.6
    while len(buffer) < 4 * 1024 * 1024:
        wait = end - time.monotonic()
        if wait <= 0 or not select.select([fd], [], [], wait)[0]:
            break
        chunk = os.read(fd, 65536)
        if not chunk:
            break
        buffer += chunk
        if buffer.rstrip().endswith(b'}'):
            try:
                return json.loads(buffer.decode('utf-8-sig'))
            except (ValueError, UnicodeDecodeError):
                pass
    return json.loads(buffer.decode('utf-8-sig'))


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.' + path.name + '.' + str(os.getpid()))
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        for attempt in range(4):
            try:
                temporary.replace(path)
                return
            except PermissionError:
                if attempt == 3:
                    raise
                time.sleep(.01)
    finally:
        with contextlib.suppress(OSError):
            temporary.unlink()


@contextlib.contextmanager
def locked(name='.cursor-bridge.lock'):
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / name).open('a+b') as lock:
        until = time.monotonic() + .15
        while True:
            lock.seek(0)
            try:
                if os.name == 'nt':
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= until:
                    raise TimeoutError('state lock')
                time.sleep(.005)
        try:
            yield
        finally:
            lock.seek(0)
            if os.name == 'nt':
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock, fcntl.LOCK_UN)


def character_for_model(model):
    """和 crosspet-hook.py 的 character_for_model 同一套规则（tests/cursor_bridge_test.py 对拍两边）"""
    m = str(model).lower()
    if 'glm' in m or 'zhipu' in m or 'chatglm' in m or 'z.ai' in m or 'zai-' in m:
        return 'glm'
    if 'qwen' in m or 'dashscope' in m or 'bailian' in m or 'tongyi' in m or m == 'coder-model':
        return 'qwen'
    if 'kimi' in m or 'moonshot' in m:
        return 'kimi'
    if 'grok' in m:
        return 'grok'
    if 'deepseek' in m:
        return 'deepseek'
    if 'claude' in m or 'anthropic' in m:
        return 'claude'
    if 'gemini' in m:
        return 'gemini'
    if m.startswith(('gpt', 'o1', 'o3', 'o4', 'codex', 'chatgpt')) or 'openai' in m:
        return 'gpt'
    return None


def installed(cid):
    d = ROOT / 'characters' / str(cid)
    return (d / 'character.json').is_file() and any((d / ('idle.' + ext)).is_file() for ext in ('png', 'webp'))


def tool_pose(name):
    name = str(name).lower()
    for pose, terms in [('reading', ('read', 'grep', 'glob', 'list', 'codebase')),
                        ('writing', ('write', 'edit', 'patch', 'delete', 'replace')),
                        ('searching', ('browser', 'web', 'search', 'fetch')),
                        ('delegating', ('task', 'agent')),
                        ('running', ('shell', 'bash', 'terminal', 'command', 'exec'))]:
        if any(term in name for term in terms):
            return pose
    return 'thinking'


def _generation(raw):
    return hashlib.sha256(str(raw).encode()).hexdigest()[:20] if raw else ''


def _load_dict(path):
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _cursor_order(entry, kind, generation):
    """Retire observed aliases together; an unfamiliar ID is not proof of age."""
    retired = list(dict.fromkeys(entry.get('retired', [])))[-128:]
    seen = list(dict.fromkeys(entry.get('seen', [])))[-128:]
    if kind == 'sessionStart' and entry:
        return None
    if generation and generation in retired:
        return None
    if entry.get('terminal'):
        if not generation and kind != 'sessionEnd':
            return None
        # With the observer-only configuration a previously unseen generation
        # may be a legitimate next turn. Do not classify a new thought ID as old.
        seen = []
    if generation and generation not in seen:
        seen.append(generation)
    terminal = kind in ('stop', 'sessionEnd')
    if terminal:
        retired = list(dict.fromkeys(retired + seen))[-128:]
        seen = []
    return {'seen': seen[-128:], 'retired': retired, 'terminal': terminal,
            'last_event': kind, 'ts': time.time()}


def handle(event):
    if not isinstance(event, dict) or event.get('hook_event_name') not in OBSERVERS:
        return
    kind = event['hook_event_name']
    identity = event.get('conversation_id') or event.get('session_id')
    if not identity:
        return  # Never conflate unrelated unidentified conversations.
    sid = 'cursor_' + hashlib.sha256(str(identity).encode()).hexdigest()[:20]
    model = str(event.get('model_id') or event.get('model') or '')
    mapped = character_for_model(model) if model else None
    if mapped and not installed(mapped):
        mapped = None   # 对应的角色还没装立绘：当成认不出的模型
    generation = _generation(event.get('generation_id'))
    now = time.time()
    activity = {'pose': 'thinking', 'event': kind, 'tool': '', 'ts': now}
    if kind == 'sessionStart':
        activity.update(pose='idle', event='SessionStart')
    elif kind == 'beforeSubmitPrompt':
        # 你一按发送就到（其他事件都是做完才来）：没有这条的话，短对话她要等 Cursor 回答完才动
        activity.update(pose='listening', event='UserPromptSubmit')
    elif kind == 'sessionEnd':
        activity.update(pose='idle', event='SessionEnd')
    elif kind == 'stop':
        status = event.get('status')
        activity.update(pose='oops' if status == 'error' else 'surprised' if status == 'aborted' else 'happy', event='Stop')
    elif kind == 'postToolUseFailure':
        activity.update(pose='oops', event='PostToolUse')
    elif kind in ('postToolUse', 'afterShellExecution', 'afterMCPExecution', 'afterFileEdit'):
        tool = 'Shell' if kind == 'afterShellExecution' else 'Write' if kind == 'afterFileEdit' else event.get('tool_name', '')
        category = tool_pose(tool)
        activity.update(event='PostToolUse', tool=category, after=category, afterTs=now)
    elif kind == 'subagentStop':
        # Codex writes SubagentStop; the pet waits briefly, then returns to thinking.
        activity.update(pose='thinking', event='SubagentStop')
    elif kind == 'preCompact':
        activity.update(pose='compact', event='PreCompact')
    with locked():
        path = STATE / 'cursor-bridge-sessions.json'
        all_sessions = _load_dict(path)
        all_sessions = {k: v for k, v in all_sessions.items()
                        if isinstance(v, dict) and isinstance(v.get('state'), dict)}
        before = {v.get('character') or FALLBACK or 'current' for v in all_sessions.values()}
        # 这条事件没带模型（老版本 Cursor）：沿用这个会话上次的角色
        character = mapped or (None if model else all_sessions.get(sid, {}).get('character')) or FALLBACK or 'current'
        sessions = {k: v for k, v in all_sessions.items() if now - v['state'].get('ts', 0) < 600}
        order_path = STATE / 'cursor-bridge-order.json'
        orders = _load_dict(order_path)
        orders = {key: value for key, value in orders.items() if isinstance(value, dict)}
        entry = orders.get(sid)
        migrated = False
        if not isinstance(entry, dict):
            # Existing installations retain the most recent generation only.
            previous = all_sessions.get(sid)
            entry = {}
            if previous:
                old = previous.get('generation', '')
                if old == _generation('') or old == hashlib.sha256(b'').hexdigest()[:20]:
                    old = ''
                terminal = previous['state'].get('event') in ('Stop', 'SessionEnd')
                entry = {'seen': [old] if old and not terminal else [],
                         'retired': [old] if old and terminal else [], 'terminal': terminal,
                         'ts': previous['state'].get('ts', now)}
                migrated = True
        updated = _cursor_order(entry, kind, generation)
        if updated is None:
            if migrated:
                # Preserve the old completed generation before display TTL expiry;
                # the rejected event must not refresh any visible work state.
                orders[sid] = entry
                atomic(order_path, orders)
            return
        # Tools used in this turn. postToolUse / postToolUseFailure fire for every tool,
        # so the after* hooks that repeat the same call are not counted again.
        tools = 0 if entry.get('terminal') else int(entry.get('tools', 0) or 0)
        if kind == 'stop':
            if activity['pose'] == 'happy' and tools >= BIG_JOB_TOOLS:
                activity['pose'] = 'proud'
            tools = 0
        elif kind in ('postToolUse', 'postToolUseFailure'):
            tools += 1
        updated['tools'] = tools
        orders[sid] = updated
        orders = dict(sorted(orders.items(), key=lambda kv: kv[1].get('ts', 0))[-128:])
        if kind == 'sessionEnd':
            sessions.pop(sid, None)
        else:
            sessions[sid] = {'generation': generation, 'state': activity, 'character': character}
        sessions = dict(sorted(sessions.items(), key=lambda kv: kv[1]['state']['ts'])[-32:])
        active = [entry['state'] for entry in sessions.values()
                  if (entry.get('character') or FALLBACK or 'current') == character
                  and entry['state']['pose'] not in RESTING
                  and now - entry['state']['ts'] < 180]
        if active:
            activity = max(active, key=lambda state: state['ts'])
        # All acceptance decisions and outputs are serialized by the same lock.
        try:
            (STATE / 'seen-cursor').write_text(str(int(now)))
        except OSError:
            pass
        atomic(order_path, orders)
        atomic(path, sessions)
        for cid in sorted(before | {v.get('character') or FALLBACK or 'current' for v in sessions.values()} | {character}):
            write_cards(cid, sessions, now)
        # 切到 Cursor 窗口时按它最近用的模型换角色；认不出的写 null，桌宠不换人
        atomic(STATE / 'cursor-host.json', {'character': None if character == 'current' else character,
                                            'model': model, 'source': 'cursor', 'ts': now})
        atomic(STATE / f'{character}-state.json', activity)
        atomic(STATE / 'cursor-bridge-status.json', {'installed': True, 'last_event': kind,
               'artwork_ready': character == 'current' or installed(character), 'ts': now})


def write_cards(character, sessions, now):
    """<character>-sessions.json drives the pet's per-conversation cards. Other integrations can
    write the same file (crosspet-hook.py for the same character in another app), so only the
    cursor_ entries are replaced. A card shows the tool being used, like crosspet-hook.py."""
    # Use the same character-session lock as crosspet-hook.py, so its cards
    # cannot disappear between this bridge's read and atomic replacement.
    with locked(f'.{character}-sessions.lock'):
        _write_cards_locked(character, sessions, now)


def _write_cards_locked(character, sessions, now):
    path = STATE / f'{character}-sessions.json'
    others = {k: v for k, v in _load_dict(path).items()
              if not k.startswith('cursor_') and isinstance(v, dict)
              and isinstance(v.get('ts'), (int, float)) and now - v['ts'] < 600}
    cards = {}
    for k, value in sessions.items():
        if (value.get('character') or FALLBACK or 'current') != character:
            continue   # 这个会话用的是别的模型，卡片在那个角色的文件里
        state = value['state']
        pose = state.get('after') or state['pose'] if state['pose'] == 'thinking' else state['pose']
        cards[k] = {'pose': pose, 'event': state['event'], 'ts': state['ts']}
    atomic(path, {**others, **cards})


def main():
    # beforeSubmitPrompt 能拦住消息：回复不合格式 Cursor 会当成「拦下」。所以它和读不懂的事件一律回「放行」，
    # 其余观察事件照旧回 {}（它们没有输出字段）
    reply = '{"continue": true}'
    try:
        event = read_event()
        if isinstance(event, dict) and event.get('hook_event_name') != 'beforeSubmitPrompt':
            reply = '{}'
        handle(event)
    except BaseException:
        # Observer failures must never expose input or interfere with the agent.
        pass
    sys.stdout.write(reply + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
