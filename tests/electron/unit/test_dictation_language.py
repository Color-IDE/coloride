"""Automatic, recording-local language detection and provisional output gating."""
import importlib.util
import sys
import unittest
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

source = Path(__file__).resolve().parents[3] / 'client/desktop/src/dictation/streaming_language.py'
spec = importlib.util.spec_from_file_location('streaming_language', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@dataclass
class Config:
    language: str = 'es'
    decoder_type: str = 'beam'
    beam_size: int = 1
    rewind_threshold: int = 200


@dataclass
class Transcript:
    text: str = ''


class Model:
    def __init__(self, cfg):
        self.cfg = cfg
        self.state = SimpleNamespace(detected_language=None)
        self.seconds = .5
        self.probabilities = {'es': .9, 'en': .1}
        self.initialized = 0

    def segments_len(self):
        return self.seconds

    def lang_id(self, features):
        return None, [self.probabilities]

    def create_tokenizer(self, language):
        self.language = language

    def init_tokens(self):
        self.initialized += 1

    def init_context(self):
        pass


def factory(args, asr, language):
    return SimpleNamespace(asr=asr, model=Model(asr.cfg), get_buffer=lambda: Transcript('premature English'))


class SessionLanguageTest(unittest.TestCase):
    def setUp(self):
        self.args = SimpleNamespace(backend_policy='simulstreaming')
        self.weights = object()
        self.asr = SimpleNamespace(cfg=Config(), lan='es', tokenizer=object(), shared_model=self.weights, use_full_mlx=False)

    def test_legacy_language_is_ignored_and_recordings_have_independent_detection(self):
        a = module.session_online_factory(factory, self.args, self.asr, 'es')
        b = module.session_online_factory(factory, self.args, self.asr, 'fr')
        self.assertEqual(a.model.cfg.language, 'auto')
        self.assertEqual(a.model.cfg.decoder_type, 'greedy')
        self.assertIsNot(a.model.cfg, b.model.cfg)
        self.assertIs(a.asr.shared_model, self.weights)
        self.assertEqual(self.asr.cfg.language, 'es')
        self.assertIsNone(a.asr.tokenizer)

    def test_confident_language_locks_after_one_second_and_does_not_flip(self):
        processor = module.session_online_factory(factory, self.args, self.asr)
        model = processor.model
        model._detect_language_if_needed(None)
        self.assertIsNone(model.state.detected_language)
        model.seconds = 1.0
        model._detect_language_if_needed(None)
        self.assertEqual(model.state.detected_language, 'es')
        model.probabilities = {'fr': 1.0}
        model._detect_language_if_needed(None)
        self.assertEqual(model.state.detected_language, 'es')
        self.assertEqual(model.initialized, 1)

    def test_ambiguous_speech_waits_for_more_audio(self):
        model = module.session_online_factory(factory, self.args, self.asr).model
        model.seconds = 1.5
        model.probabilities = {'fr': .6, 'en': .4}
        model._detect_language_if_needed(None)
        self.assertIsNone(model.state.detected_language)
        model.seconds = 2.5
        model._detect_language_if_needed(None)
        self.assertEqual(model.state.detected_language, 'fr')

    def test_provisional_english_is_hidden_until_language_is_detected(self):
        processor = module.session_online_factory(factory, self.args, self.asr)
        with patch.dict(sys.modules, {'whisperlivekit.timed_objects': SimpleNamespace(Transcript=Transcript)}):
            self.assertEqual(processor.get_buffer().text, '')
        processor.model.state.detected_language = 'es'
        self.assertEqual(processor.get_buffer().text, 'premature English')


if __name__ == '__main__':
    unittest.main()
