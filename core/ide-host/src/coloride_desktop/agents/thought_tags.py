from __future__ import annotations


class ThoughtTagParser:
    """Separate leading thought wrappers, retaining partial tags across chunks."""

    def __init__(self) -> None:
        self.pending = ""
        self.state = "prefix"

    def feed(self, text: str, *, final: bool = False) -> list[tuple[str, str]]:
        self.pending += text
        result: list[tuple[str, str]] = []
        while self.pending:
            if self.state == "text":
                result.append(("text", self.pending))
                self.pending = ""
                break
            if self.state == "prefix":
                candidate = self.pending.lstrip()
                if not candidate and not final:
                    break
                if candidate.startswith("<thought>"):
                    self.pending = candidate[len("<thought>"):]
                    self.state = "thought"
                    continue
                if "<thought>".startswith(candidate) and not final:
                    break
                self.state = "text"
                continue
            closing = "</thought>"
            index = self.pending.find(closing)
            if index >= 0:
                if index:
                    result.append(("reasoning", self.pending[:index]))
                self.pending = self.pending[index + len(closing):]
                self.state = "prefix"
                continue
            retained = 0
            if not final:
                for length in range(1, min(len(closing), len(self.pending) + 1)):
                    if self.pending.endswith(closing[:length]):
                        retained = length
            emitted = self.pending[:-retained] if retained else self.pending
            if emitted:
                result.append(("reasoning", emitted))
            self.pending = self.pending[-retained:] if retained else ""
            break
        return result


def split_thought_tags(text: str) -> tuple[str, str]:
    chunks = ThoughtTagParser().feed(text, final=True)
    return (
        "".join(value for kind, value in chunks if kind == "text"),
        "".join(value for kind, value in chunks if kind == "reasoning"),
    )
