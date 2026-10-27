"""Automatic per-recording language detection for the streaming decoder."""
from copy import copy
from dataclasses import replace
from types import MethodType


def detect_language(model, encoder_feature):
    if model.state.detected_language is not None:
        return
    seconds = model.segments_len()
    if seconds < 1.0:
        return
    _, probabilities = model.lang_id(encoder_feature)
    language, confidence = max(probabilities[0].items(), key=lambda item: item[1])
    # Short confident speech can lock early; ambiguous speech gets more context.
    if confidence < .75 and seconds < 2.5:
        return
    model.create_tokenizer(language)
    model.state.last_attend_frame = -model.cfg.rewind_threshold
    model.state.cumulative_time_offset = 0.0
    model.init_tokens()
    model.init_context()
    model.state.detected_language = language


def mlx_language_id(model, encoder_features):
    # WLK 0.2.26's MLX language mask adds False to True, leaving every language
    # masked. Select language logits directly so detection has valid probabilities.
    import mlx.core as mx
    tokenizer = model.tokenizer
    tokens = mx.array(list(tokenizer.all_language_tokens), dtype=mx.int32)
    start = mx.full((encoder_features.shape[0], 1), tokenizer.sot, dtype=mx.int32)
    logits, _, _ = model.model.decoder(start, encoder_features, kv_cache=None)
    probabilities = mx.softmax(mx.take(logits[:, 0], tokens, axis=-1), axis=-1)
    detected = mx.take(tokens, mx.argmax(probabilities, axis=-1))
    maps = [dict(zip(tokenizer.all_language_codes, row)) for row in probabilities.tolist()]
    model._clean_cache()
    return detected, maps


def session_online_factory(factory, args, asr, language=None):
    # Every capture is automatic, regardless of legacy saved language settings.
    if args.backend_policy != 'simulstreaming':
        return factory(args, asr, language='auto')
    session_asr = copy(asr)
    session_asr.cfg = replace(asr.cfg, language='auto', decoder_type='greedy', beam_size=1)
    session_asr.lan = 'auto'
    session_asr.tokenizer = None
    processor = factory(args, session_asr, language=None)
    model = processor.model
    model._detect_language_if_needed = MethodType(detect_language, model)
    if session_asr.use_full_mlx:
        model.lang_id = MethodType(mlx_language_id, model)
    get_buffer = processor.get_buffer

    def detected_buffer():
        if model.state.detected_language is None:
            from whisperlivekit.timed_objects import Transcript
            return Transcript()
        return get_buffer()

    processor.get_buffer = detected_buffer
    return processor
