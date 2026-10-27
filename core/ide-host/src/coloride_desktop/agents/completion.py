"""Provider-independent completion evidence. Never infer success from prose."""
from __future__ import annotations

import posixpath
import re
import shlex
from pathlib import PurePosixPath
from typing import Any

COMPLETE_TASK_SCHEMA = {
    'type': 'function', 'name': 'complete_task',
    'description': ('Conclude an implementation only after fulfilling ALL registered requirement IDs and '
                    'running relevant successful checks after the last edit. Cite verification tool call IDs '
                    'from TASK COMPLETION. If blocked or no safe verification exists, report that outcome '
                    'and reason instead of claiming completion. Read-only analysis without mutations '
                    'may finish with empty verification_ids; do not invent test evidence. '
                    'This tool does not edit files.'),
    'parameters': {'type':'object', 'properties': {
        'outcome': {'type':'string', 'enum':['completed','pending_verification','blocked']},
        'summary': {'type':'string','minLength':1},
        'requirements': {'type':'array','items':{'type':'string'},
                         'description':('Exact requirement IDs from TASK COMPLETION '
                                        '(usually goal), not requirement text.')},
        'verification_ids': {'type':'array','items':{'type':'string'},
                             'description':('Exact IDs of successful checks at the current revision '
                                            'in TASK COMPLETION.')},
        'reason': {'type':'string'},
    }, 'required':['outcome','summary','requirements','verification_ids','reason'],
        'additionalProperties':False},
}


def state(task: Any) -> dict[str, Any]:
    if not task.completion:
        task.completion = {'version':1, 'outcome':'unknown', 'revision':0,
                           'requirements':{'goal':task.goal}, 'evidence':[], 'accepted':False}
    return task.completion


def _command_chain(command: str) -> list[list[str]]:
    """Only simple commands joined by && preserve every command's exit status."""
    segments = command.split('&&')
    if any(re.search(r'[;&|`<>\n]|\$\(', segment) for segment in segments):
        return []
    try:
        commands = [shlex.split(segment) for segment in segments]
    except ValueError:
        return []
    return commands if all(commands) else []


def _read_only_command(parts: list[str]) -> bool:
    program = PurePosixPath(parts[0]).name
    args = parts[1:]
    if (program in {'node', 'npm', 'pnpm', 'yarn', 'bun', 'pytest', 'cargo', 'go', 'ruff'}
            or re.fullmatch(r'python(?:3(?:\.\d+)?)?', program)) and args in (
                ['--version'], ['-V'], ['--help'], ['-h'],
            ):
        return True
    if program == 'git':
        return bool(args and args[0] in {'status', 'show', 'log', 'diff', 'rev-parse', 'ls-files', 'ls-tree'}
                    and not any(arg.startswith(('--output', '--ext-diff', '--textconv')) for arg in args))
    if program in {'rg', 'grep'}:
        return not any(arg.startswith(('--pre', '--hostname-bin')) for arg in args)
    if program == 'find':
        return not any(arg.startswith(('-delete', '-exec', '-ok', '-fprint', '-fls')) for arg in args)
    return program in {'cat', 'head', 'tail', 'ls', 'pwd', 'wc', 'echo', 'printf'}


def _verification_entrypoint(parts: list[str], depth: int = 0) -> bool:
    if depth >= 8:
        return False  # Malformed wrapper chains must not crash the tool loop.
    while parts and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*=.*', parts[0]):
        parts = parts[1:]
    if not parts:
        return False
    program = PurePosixPath(parts[0]).name
    args = parts[1:]
    if program == 'env':
        return bool(args and _verification_entrypoint(args, depth + 1))
    if program == 'corepack' and args:
        return _verification_entrypoint(args, depth + 1)
    # Help, version and discovery commands often exit zero without checking
    # changed code. Apply this to wrappers as well as direct executables.
    non_checks = {'--help', '-h', '--version', '-V', '--collect-only', '--co',
                  '--listTests', '--list-tests', '--no-run', '--showConfig',
                  '--print-config', '--fixtures', '--fixtures-per-test'}
    if any(arg.split('=', 1)[0] in non_checks or arg == '-list' or arg.startswith('-list=')
           for arg in args):
        return False
    if program == 'npx':
        return bool(args and args[0] in {'vitest', 'jest', 'tsc', 'eslint'}
                    and _verification_entrypoint(args, depth + 1))
    if program in {'npm','pnpm','yarn','bun'}:
        if args and args[0] == 'exec':
            nested = args[1:]
            if nested[:1] == ['--']:
                nested = nested[1:]
            return bool(nested and _verification_entrypoint(nested, depth + 1))
        if args and args[0] == 'run':
            args = args[1:]
        return bool(args and re.fullmatch(r'(test|build|typecheck|lint|check)(:[\w-]+)?', args[0]))
    if re.fullmatch(r'python(?:3(?:\.\d+)?)?', program):
        while args and args[0] in {'-B', '-I', '-E', '-s', '-S', '-u', '-q'}:
            args = args[1:]
        return len(args) > 1 and args[0] == '-m' and args[1] in {'pytest','unittest','compileall'}
    if program in {'pytest','vitest','jest','tsc','eslint','mypy'}:
        return not (program == 'vitest' and args[:1] == ['list'])
    return (program, args[0] if args else '') in {
        ('cargo','test'),('cargo','check'),('go','test'),('ruff','check'),
    }


def verification_command(command: str) -> bool:
    commands = _command_chain(command)
    return bool(commands and any(_verification_entrypoint(parts) for parts in commands)
                and all(_verification_entrypoint(parts) or _read_only_command(parts) for parts in commands))


def read_only_command(command: str) -> bool:
    commands = _command_chain(command)
    return bool(commands and all(_read_only_command(parts) for parts in commands))


def long_running_server_command(command: str) -> bool:
    """Recognize a direct server/watch launch that is itself the requested result."""
    commands = _command_chain(command)
    if len(commands) != 1:
        return False
    parts = commands[0]
    while parts and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*=.*', parts[0]):
        parts = parts[1:]
    if not parts:
        return False
    program = PurePosixPath(parts[0]).name
    args = parts[1:]
    if program == 'corepack' and args:
        return long_running_server_command(shlex.join(args))
    if program in {'npm', 'pnpm', 'yarn', 'bun'}:
        if args[:1] == ['run']:
            args = args[1:]
        return bool(args and re.fullmatch(r'(dev|start|watch|serve|preview)(:[\w-]+)?', args[0]))
    if program == 'next':
        return args[:1] == ['dev']
    if program in {'vite', 'vite-node'}:
        return True
    return bool(
        re.fullmatch(r'python(?:3(?:\.\d+)?)?', program)
        and args[:2] == ['-m', 'http.server']
    )


def _absolute(path: str, cwd: str) -> PurePosixPath:
    value = PurePosixPath(path)
    absolute = value if value.is_absolute() else PurePosixPath(cwd) / value
    return PurePosixPath(posixpath.normpath(str(absolute)))


def _covers_changes(task: Any, evidence: list[dict[str, Any]], cwd: str) -> bool:
    root = _absolute(cwd, '/')
    scopes = [_absolute(str(e['scope']), str(root)) for e in evidence]
    scopes = [scope for scope in scopes if scope.is_relative_to(root)]
    paths = [_absolute(str(path), str(root)) for path in task.files_changed] or [root]
    return all(any(path.is_relative_to(scope) for scope in scopes) for path in paths)


def _latest_checks(current: dict[str, Any]) -> list[dict[str, Any]]:
    return list({(e['command'], e['scope']):e for e in current['evidence']
                 if e['revision'] == current['revision']}.values())


def record_result(task: Any, call: Any, *, failed: bool, metadata: dict[str, Any], cwd: str) -> None:
    current = state(task)
    mutations = {'write_file','replace_in_file','rename_path','move_path','delete_path','create_directory'}
    command = str(call.arguments.get('command') or '')
    is_check = call.name == 'execute_command' and verification_command(command)
    is_server_launch = (
        call.name in {'run_terminal_command', 'start_process'}
        and long_running_server_command(command)
    )
    # Shell writes have no structured path/diff. Unclassified commands can
    # mutate even before the first file tool, including partial failed writes.
    # Known inspection commands and file reads keep read-only analysis usable.
    command_may_mutate = (
        call.name in {'execute_command', 'run_terminal_command'}
        and not is_check
        and not is_server_launch
        and not read_only_command(command)
    )
    has_mutations = bool(current.get('hasMutations') or task.files_changed or call.name in mutations
                         or command_may_mutate or (call.name == 'start_process' and not is_server_launch))
    current['hasMutations'] = has_mutations
    if call.name in mutations or (has_mutations and (
        command_may_mutate
        or (call.name == 'start_process' and not is_server_launch) or call.name.startswith('mcp_')
    )):
        current['revision'] += 1
        current['accepted'] = False
        current['outcome'] = 'pending_verification'
        task.verification_required = True
        task.verification_attempted = False
    scope = str(_absolute(str(call.arguments.get('cwd') or cwd), cwd))
    success = is_check and not failed and metadata.get('exitCode') == 0
    if is_check:
        current['evidence'].append({'id':call.call_id, 'revision':current['revision'],
                                    'scope':scope, 'command':command, 'passed':success})
        current['evidence'] = current['evidence'][-64:]
        task.verification_attempted = True
    # Existing heuristic flags cannot override the evidence ledger.
    latest = _latest_checks(current)
    task.verification_required = has_mutations and (
        any(not e['passed'] for e in latest)
        or not _covers_changes(task, [e for e in latest if e['passed']], cwd)
    )


def complete(task: Any, arguments: dict[str, Any], cwd: str) -> dict[str, Any]:
    current = state(task)
    outcome = arguments.get('outcome')
    summary = str(arguments.get('summary') or '').strip()
    if outcome not in {'completed','pending_verification','blocked'} or not summary:
        raise ValueError('Provide a valid outcome and a non-empty summary')
    if outcome == 'completed':
        required = set(current['requirements'])
        if set(arguments.get('requirements') or []) != required:
            raise ValueError(f'Address all requirement IDs: {sorted(required)}')
        requested = set(arguments.get('verification_ids') or [])
        evidence = [e for e in current['evidence'] if e['id'] in requested
                    and e['passed'] and e['revision']==current['revision']]
        has_mutations = bool(current.get('hasMutations') or task.files_changed or current['revision'])
        if has_mutations and (not requested or {e['id'] for e in evidence} != requested):
            available = [e['id'] for e in _latest_checks(current) if e['passed']]
            hint = (f" Current successful verification tool IDs: {available}."
                    if available else " No successful check is recorded after the last modification.")
            raise ValueError('Completion requires successful verification tool IDs '
                             'after the last modification. '
                             'Run a standalone check such as npm test, then cite '
                             'its current TASK COMPLETION ID. '
                             'Do not reuse IDs from file reads or other commands.' + hint)
        if any(not e['passed'] for e in _latest_checks(current)):
            raise ValueError('A current verification check is still failing')
        if has_mutations and not _covers_changes(task, evidence, cwd):
            raise ValueError('No current verification covers all changed paths in this workspace')
        if task.unresolved_questions:
            raise ValueError('Task still has unresolved questions')
    elif not str(arguments.get('reason') or '').strip():
        raise ValueError('Explain the blocker or why verification is unavailable')
    current.update(outcome=outcome, accepted=True, summary=summary, reason=arguments.get('reason',''))
    task.verification_required = outcome != 'completed'
    return {'outcome':outcome,'summary':summary,'reason':current['reason']}
