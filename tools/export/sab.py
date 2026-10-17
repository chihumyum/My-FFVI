"""Read the single-sound SAB program used by this build's scripted environment audio.

Container layout: vgmstream r2117 sqex_sead.c. Track command semantics: source
sead.dll 0x59c90 / 0x59830 / 0xf750. This is not a general SEAD mixer.
"""
import math
import struct


def environment_program(data):
    def raw(offset, size):
        if offset < 0 or size < 0 or offset + size > len(data):
            raise ValueError('Truncated SAB range')
        return data[offset:offset + size]

    def u8(offset): return raw(offset, 1)[0]
    def u16(offset): return struct.unpack('<H', raw(offset, 2))[0]
    def u32(offset): return struct.unpack('<I', raw(offset, 4))[0]
    def f32(offset):
        value = struct.unpack('<f', raw(offset, 4))[0]
        if not math.isfinite(value): raise ValueError('Nonfinite SAB value')
        return value

    if raw(0, 4) != b'sabf' or u8(4) != 2 or u32(12) != len(data) or u8(8) != 4:
        raise ValueError('Unsupported SAB header')
    table = (16 + (u8(9) or 15) + 1 + 15) // 16 * 16
    sections = []
    for i, name in enumerate([b'snd ', b'seq ', b'trk ', b'mtrl']):
        entry = table + i * 16
        if raw(entry, 4) != name: raise ValueError('Unsupported SAB sections')
        at = u32(entry + 8)
        if u16(at + 4) != 1: raise ValueError('SAB needs multiple sound/sequence/track/material support')
        first = at + u32(at + 16)
        raw(first, 16)
        sections.append((at, first))
    if [x[0] for x in sections] != sorted(set(x[0] for x in sections)):
        raise ValueError('Unordered SAB sections')
    (_, sound), (_, sequence), (track_section, track), (material_section, _) = sections
    if (u8(sound), u16(sound + 2), u8(sound + 4), u8(sound + 5)) != (17, 96, 1, 1):
        raise ValueError('Unsupported SAB sound program')
    sequence_info = sound + u16(sound + 26)
    if u16(sequence_info + 2) != 16 or u16(sequence_info + 4) != 0:
        raise ValueError('Unexpected SAB sequence reference')
    if (u8(sequence), u16(sequence + 2), u8(sequence + 8)) != (4, 32, 0):
        raise ValueError('Unsupported SAB sequence configuration')
    command = sequence + u16(sequence + 6)
    if raw(command, 4) != bytes([2, 4, 2, 12]) or u32(command + 4) != 0 or u8(command + 8) not in (0, 1):
        raise ValueError('Unsupported SAB key-on')
    looping = bool(u8(command + 8))
    if raw(command + 16, 4) != bytes([0, 4, 1, 0]) or any(raw(command + 20, track_section - command - 20)):
        raise ValueError('Unsupported SAB sequence continuation')
    if (u8(track), u8(track + 1), u16(track + 2), u16(track + 4)) != (2, 1, 16, 0):
        raise ValueError('Unsupported SAB track reference')
    cursor = track + u16(track + 14)
    gain, ramp, commands = 1.0, None, []
    while cursor < material_section:
        version, header, kind, body = raw(cursor, 4)
        if header != 4: raise ValueError('Unsupported SAB command header')
        if kind == 1:
            if body or any(raw(cursor + 4, material_section - cursor - 4)):
                raise ValueError('Unsupported SAB track continuation')
            break
        if body != 12 or version not in (0, 1): raise ValueError('Unsupported SAB track command')
        value, duration, curve = f32(cursor + 4), u32(cursor + 8), u8(cursor + 12)
        if curve or any(raw(cursor + 13, 3)): raise ValueError('Unsupported SAB curve')
        commands.append({'offset': cursor, 'kind': kind, 'value': value, 'durationMs': duration})
        if kind == 3:
            if value < 0 or value > 1 or ramp is not None:
                raise ValueError('Unsupported SAB volume program')
            if duration:
                ramp = {'from': gain, 'to': value, 'durationMs': duration}
            else:
                gain = value
        elif (kind, value, duration) not in [(4, 1, 0), (5, 0, 0), (6, 1, 0), (15, 0, 0), (16, 0, 0)]:
            raise ValueError('Unsupported SAB track parameter')
        cursor += header + body
    else:
        raise ValueError('SAB track lacks end command')
    level = f32(sound + 12)
    if level < 0 or level > 1: raise ValueError('Unsupported SAB base volume')
    return {'gain': level * (1 if ramp else gain), 'gainRamp': ramp, 'looping': looping,
            'program': {'soundOffset': sound, 'sequenceOffset': sequence, 'trackOffset': track,
                        'soundHeader': raw(sound, 96).hex(), 'commands': commands}}
