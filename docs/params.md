# ToneLab SE SoundEditor: editor behaviour not covered by the Korg MIDI Implementation PDF

Scope: only what `reference/docs/tonelabse_midi.pdf` does not say: exact display strings and format
calls, label bitmaps, what happens on TYPE / EXP target changes, default tables, and program-name
handling. Evidence is Ghidra addresses in `SeTnLbSE.EXE` (functions renamed in the Ghidra DB as
listed). Unless a line is marked *inferred*, it was read from code or data.

Factory-preset cross-check (`ToneLabSE_Preset.TLP`, 96 programs): every knob value lies inside the
editor's per-type min/max below, and every slot the editor hides for a type holds 0.

## 0. Knob slot -> program byte (editor internal)

Each effect page has 6 knob slots. `MapControlIdToProgramOffset` (0x409412) maps them as follows:

| section | slot 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| pedal (ctl 100-105) | 14 | 15 | 16 | 17 | 18 | 19 |
| mod (ctl 300-305) | 23 | 24 | 25 | 26 | 27 | 28 |
| delay (ctl 0x132-0x137) | 32-33 (TIME, 16-bit BE) | 34 | 35 | 36 | 37 | 38 |
| reverb (ctl 0x138-0x13D) | 41 | 42 | 43 | 44 | 45 | 46 |

The delay slots line up with the PDF's relative offsets 00-01, 02, 03, 04, 05, 06. So RHYTHM (PDF
offset 05) is **byte 37**, not 36. Byte 36 is DUCKING.

## 1. TALK MOD "TYPE" (mod type 10, slot 2 = byte 25, raw 0-9)

Display: `lstrcpy` from the string table at 0x418f9c (`FormatModKnobText` 0x40207f, case 0x7a):

| raw | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| text | `A-E` | `A-I` | `A-O` | `A-U` | `E-I` | `E-O` | `E-U` | `I-O` | `I-U` | `O-U` |

## 2. RHYTHM DELAY "RHYTHM" (delay type 8, slot 4 = byte 37, raw 0-10)

The value is shown as plain text, not as a note symbol or bitmap: `sprintf("%d", raw+1)` gives
`1`..`11` (`FormatDelayKnobText` 0x402261, 0x40233a, format at 0x42039e). The editor has no table
that maps the numbers to rhythm patterns. The label bitmap DELAY8 just reads "RHYTHM".

## 3. Display formatting (exact)

The text buffer is 12 chars, and all strings are produced by `wsprintf`-style calls (0x413a98).

| kind | function | rule (r = raw byte) | examples |
|---|---|---|---|
| tenths | `FormatTenthsText` 0x401e56 | `"%d.%01d"`, r/10, r%10 | 0 -> `0.0`, 100 -> `10.0` |
| tenths+1 (the PDF's 00~5A = 1.0~10.0 params) | `FormatTenthsPlusOneText` 0x401e86 | `"%d.%01d"` of (r+10) | 0 -> `1.0`, 90 -> `10.0` |
| speed Hz | `FormatModSpeedHzText` 0x401d52 | r==100: literal `10.00 Hz`; r<=9: m=100+5r, `"%d.%03d Hz"` (m/1000, m%1000); otherwise centi-Hz c (see table), `"%d.%02d Hz"` | `0.100 Hz`, `0.145 Hz`, `0.15 Hz`, `1.45 Hz`, `10.00 Hz` |
| pitch (PITCH SHIFTER PITCH, byte 23) | `FormatModKnobText` 0x4020dd | `"%+02d"` of r-24, with no "semitone" suffix | `-24`, `-5`, `+0`, `+12`, `+24` |
| fine (PITCH SHIFTER FINE, byte 24) | 0x402108 | `"%+02d cent"` of r-50 | `-50 cent`, `+0 cent`, `+50 cent` |
| tracking (PITCH SHIFTER, slot 3, byte 26, raw 5-75) | 0x402173 | `"%d ms"` of r*2 | `10 ms`..`150 ms` |
| delay TIME (bytes 32-33) | 0x40229d | `"%d ms"` of the raw 16-bit value | `1 ms`..`8000 ms` |
| reverb PRE DLY (slot 3, byte 44) | 0x402407 | `"%d ms"` of r | `0 ms`..`100 ms` |
| GATE TIME (reverb type 10, slot 0, byte 41, raw 1-100) | 0x4023ce | `"%d ms"` of r*5 | `5 ms`..`500 ms` |
| 1-based integer | various | `"%d"` of r+1 | MODE 1-3 (mod 0/8 slot 4), MULTI HEAD MODE 1-5, RHYTHM 1-11, GATE SHAPE 1-2 |
| NR SENS (bytes 57/71, raw 0-50) | `FormatNrSensText` 0x40267b | r==0: `OFF`; otherwise `"%d.%01d"` of r*2 | `OFF`, `0.2`..`10.0` |
| option list | lstrcpy | see below | |

Option strings (long forms are what gets displayed; each list continues after an empty string with
short aliases such as `S`, `P1`, `S1`, `BL`, `OR1`, `847`, `POS`, `DN`, which are never indexed by the
display code. *Inferred*: they are leftovers or input aliases.)
- 0x418f84 polarity: `UP`, `DOWN` (pedal AUTO WAH byte 15; mod FILTRON/TALK MOD byte 27)
- 0x418f34 wah type: `V847`, `V848` (pedal VOX WAH / AUTO WAH byte 18)
- 0x418f4c phase type: `BLK`, `ORG1`, `ORG2` (pedal BLK/ORG PHASE byte 18)
- 0x418f6c order: `PRE`, `POST` (pedal types 2, 3, 5, byte 19)
- 0x418fc8 BI CHORUS mode (mod type 3, byte 27): `SERIAL`, `PARA1`, `PARA2`, `PARA3`
- 0x418ff0 DUO PHASE mode (mod type 4, byte 27): `SERIAL1`, `SERIAL2`, `PARA1`, `PARA2`, `PARA3`
- factor 0x418408: `1/6 1/4 1/3 1/2 2/3 3/4 1 4/3 3/2 2 3 4`

Speed table (raw -> text; used by every SPEED knob, including U-VIBE 50-100, TEXTREM 50-100, ROTARY 45-100,
MOD DELAY speed (delay type 3, byte 37) and PHASE speed). Centi-Hz breakpoints:
r 10-24: c=r+5; 25-39: c=30+2(r-25); 40-49: c=60+4(r-40); 50-59: c=100+5(r-50); 60-74: c=150+10(r-60);
75-89: c=300+20(r-75); 90-99: c=600+40(r-90).

| r | +0 | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 |
|---|---|---|---|---|---|---|---|---|---|---|
|   0 | 0.100 Hz | 0.105 Hz | 0.110 Hz | 0.115 Hz | 0.120 Hz | 0.125 Hz | 0.130 Hz | 0.135 Hz | 0.140 Hz | 0.145 Hz |
|  10 | 0.15 Hz | 0.16 Hz | 0.17 Hz | 0.18 Hz | 0.19 Hz | 0.20 Hz | 0.21 Hz | 0.22 Hz | 0.23 Hz | 0.24 Hz |
|  20 | 0.25 Hz | 0.26 Hz | 0.27 Hz | 0.28 Hz | 0.29 Hz | 0.30 Hz | 0.32 Hz | 0.34 Hz | 0.36 Hz | 0.38 Hz |
|  30 | 0.40 Hz | 0.42 Hz | 0.44 Hz | 0.46 Hz | 0.48 Hz | 0.50 Hz | 0.52 Hz | 0.54 Hz | 0.56 Hz | 0.58 Hz |
|  40 | 0.60 Hz | 0.64 Hz | 0.68 Hz | 0.72 Hz | 0.76 Hz | 0.80 Hz | 0.84 Hz | 0.88 Hz | 0.92 Hz | 0.96 Hz |
|  50 | 1.00 Hz | 1.05 Hz | 1.10 Hz | 1.15 Hz | 1.20 Hz | 1.25 Hz | 1.30 Hz | 1.35 Hz | 1.40 Hz | 1.45 Hz |
|  60 | 1.50 Hz | 1.60 Hz | 1.70 Hz | 1.80 Hz | 1.90 Hz | 2.00 Hz | 2.10 Hz | 2.20 Hz | 2.30 Hz | 2.40 Hz |
|  70 | 2.50 Hz | 2.60 Hz | 2.70 Hz | 2.80 Hz | 2.90 Hz | 3.00 Hz | 3.20 Hz | 3.40 Hz | 3.60 Hz | 3.80 Hz |
|  80 | 4.00 Hz | 4.20 Hz | 4.40 Hz | 4.60 Hz | 4.80 Hz | 5.00 Hz | 5.20 Hz | 5.40 Hz | 5.60 Hz | 5.80 Hz |
|  90 | 6.00 Hz | 6.40 Hz | 6.80 Hz | 7.20 Hz | 7.60 Hz | 8.00 Hz | 8.40 Hz | 8.80 Hz | 9.20 Hz | 9.60 Hz |
| 100 | 10.00 Hz |

Amp knobs (bytes 50-56 / 64-70) use tenths: 0.0-10.0.

EXP MIN/MAX text (`FormatExpRangeText` 0x4025a0) is formatted with the target knob's own formatter for
the current effect type, so a delay TIME target shows `ms` and a SPEED target shows `Hz`. For targets
with no knob (OFF, VOLUME, D/INPUT, R/INPUT, GAIN A/B, VRGN A/B) it uses tenths, `0.0`-`10.0`.

The editor also has reverse parsers for values typed into the text boxes (`0x402bfe`, `0x402c42`,
`0x402f53`, `0x4030ce`, `0x403200`, `0x403244`, `0x40333a`, dispatched by `0x4033d3`). These were not
analysed.

### Label bitmaps (`PaintKnobLabelBitmap` 0x405fd2)
- pedal: types 0-7 use `PEDAL0`-`PEDAL7`, and types 8-15 (all the drives) use `PEDAL8` (DRIVE/LEVEL/TONE).
- mod: type n uses `MODn` (type 10 = `MODA`).
- delay: 0 `DELAY0` (TIME FEEDBACK TONE - LO DAMP MIX), 1 `DELAY1` (... MODE MIX), 2/9/10 `DELAY2`
  (TIME FEEDBACK TONE - - MIX), 3 `DELAY3` (... SPEED MIX), 4 `DELAY4` (... SENS MIX), 5/6/7 `DELAY5`
  (... DUCKING - MIX), 8 `DELAY8` (... DUCKING RHYTHM MIX).
- reverb: type 10 uses `REVA` (TIME LO DAMP HI DAMP PRE DLY SHAPE MIX); every other type uses `REV0` (no SHAPE).
- amp tab: `ACH_TAB` or `BCH_TAB` according to byte 11 bit 1.

Note: the DELAY0 bitmap labels ECHO PLUS slot 4 (byte 37) as "LO DAMP". It is displayed as tenths
0.0-10.0, raw 0-100.

## 4. Changing TYPE or EXP target

**Effect TYPE change** (combo window proc `HandleTypeComboWndProc` 0x40664c -> per-page init
`InitPedalKnobsForType` 0x403bae, `InitModKnobsForType` 0x403601, `InitDelayKnobsForType` 0x403808,
`InitReverbKnobsForType` 0x4039db, called with reset=1):
1. Only the TYPE parameter change is sent (`SetAndSendProgramParam` 0x404716 -> 0x409736).
2. In the edit buffer only (`0x404701`, which does not transmit):
   - the section's on/off bit is forced ON (byte 10: pedal b0, mod b1, delay b2, reverb b3);
   - all 6 knob slots are set to the per-type **default** from the tables below;
   - `ResetExpTargetsOnTypeChange` (0x403d97) runs:
     - if EXP1 or EXP2 targets a knob of the section whose type changed, that EXP target becomes
       list index 0 (`--OFF--`) with MIN=0 and MAX=100;
     - special case: changing the pedal to VOX WAH (type 2) always sets EXP1 target = P/MANUAL (byte 17,
       code 001000), EXP1 MIN = 0, MAX = 90 (the MANUAL range).
3. The editor then marks the program modified. Nothing else is sent: no dump and no re-request.
   *Inferred*: the ToneLab SE firmware performs the same resets itself when it receives the TYPE
   change, so a rebuild must apply the same resets locally to stay in sync. Alternatively, it can
   re-request the current program (func 0x10) after a TYPE change to be safe.

**Amp / cabinet type change** (0x8d-0x90): sends the type, then forces that block's ON bit in the
buffer only (byte 10 b4/b5 for A, b6/b7 for B). Amp knobs are **not** reset. If the edited control
belongs to the other channel, `SelectAmpChannelForControl` (0x404312) sends a real param change for
byte 11 b1 (A/B), so editing a B-channel control switches the device to channel B.

**EXP target change** (0x97/0x98): sends the target. `SetupExpRangeSliders` (0x403e96, reset=1)
then sets MIN = target knob min and MAX = target knob max for the current type of that section, or
0/100 for knob-less targets. These are written to the buffer only and are not sent. *Inferred*: the
device resets them too.

### Default / range tables
Each table entry is `{int32 min, int32 max, int32 default}` (12 bytes) per type, one table per slot.
A slot is hidden when min == max. Pointer arrays: pedal 0x419a10, mod 0x419398, delay 0x4196c8,
reverb 0x4199f8 (6 slot pointers each). Amp 0x419020 (8 entries; min/max only used: 0-100, NR SENS 0-50).
Entries below are min-max/default, with `-` for unused slots.

```
pedal  slot0       slot1      slot2      slot3     slot4   slot5
 t0  0-90/19     0-100/54   0-90/19    -         -       -        COMP
 t1  0-90/70     0-100/56   0-100/63   -         -       -        ACOUSTIC
 t2  -           0-90/32    0-90/36    0-90/75   0-1/1   0-1/0    VOX WAH
 t3  0-100/50    0-1/0      0-90/38    -         0-1/1   0-1/0    AUTO WAH
 t4  50-100/72   0-100/50   0-100/50   -         -       -        U-VIBE
 t5  0-100/50    0-100/100  0-100/26   0-90/40   0-2/0   0-1/0    BLK/ORG PHASE
 t6  0-100/50    0-100/35   0-100/17   -         -       -        OCTAVE
 t7  0-100/50    0-100/100  0-90/43    0-100/55  -       -        RING MOD
 t8  0-90/60     0-100/60   0-90/50    (drives: DRIVE LEVEL TONE)
 t9  0-90/21     0-100/79   0-90/71
 t10 0-90/8      0-100/91   0-90/73
 t11 0-90/35     0-100/38   0-90/69
 t12 0-90/43     0-100/42   0-90/72
 t13 0-90/45     0-100/69   0-90/66
 t14 0-90/40     0-100/69   0-90/72
 t15 0-90/54     0-100/65   0-90/74
mod
 t0  0-100/34   0-100/58  -         0-90/0    0-2/0    -
 t1  0-100/18   0-100/31  -         0-90/34   -        0-100/40
 t2  0-100/7    0-100/71  0-100/35  0-90/67   0-100/0  0-100/75
 t3  0-100/33   0-100/43  0-100/0   0-100/38  0-3/1    0-100/56
 t4  0-100/40   0-100/76  0-100/15  0-100/20  0-4/2    -
 t5  50-100/96  0-100/42  -         -         0-100/0  -
 t6  45-100/48  0-100/50  -         45-100/99 0-90/40  -
 t7  0-48/31    0-100/50  -         5-75/40   0-100/100 0-100/80
 t8  0-100/41   0-100/38  0-100/28  0-90/47   0-2/0    0-100/50
 t9  0-90/28    0-100/72  0-100/60  0-90/0    0-1/0    0-100/50
 t10 0-90/40    0-100/100 0-9/4     0-90/40   0-1/1    0-100/50
delay (slot0 = TIME ms, 16-bit)
 t0  26-2000/315  0-100/38 0-90/59 -        0-100/19 0-100/65
 t1  1-2000/205   0-100/40 0-90/52 -        0-4/2    0-100/60
 t2  1-2000/378   0-100/34 0-90/59 -        -        0-100/65
 t3  3-2000/457   0-100/39 0-90/63 -        0-100/16 0-100/70
 t4  26-2000/457  0-100/39 0-90/63 -        0-100/53 0-100/70
 t5  1-4000/756   0-100/44 0-90/69 0-100/0  -        0-100/68
 t6  1-4000/756   0-100/44 0-90/69 0-100/0  -        0-100/68
 t7  1-4000/756   0-100/44 0-90/69 0-100/0  -        0-100/68
 t8  1-4000/504   0-100/44 0-90/69 0-100/0  0-10/5   0-100/68
 t9  1-8000/4000  0-100/0  0-90/90 -        -        0-100/85
 t10 26-4000/2000 0-100/44 0-90/69 -        -        0-100/50
reverb
 t0  0-90/60  0-100/16 0-100/26 0-100/0  -      0-100/42
 t1  0-90/50  0-100/16 0-100/26 0-100/0  -      0-100/42
 t2  0-90/33  0-100/17 0-100/25 0-100/30 -      0-100/42
 t3  0-90/42  0-100/0  0-100/30 0-100/46 -      0-100/43
 t4  0-90/44  0-100/18 0-100/13 0-100/42 -      0-100/39
 t5  0-90/51  0-100/0  0-100/32 0-100/42 -      0-100/39
 t6  0-90/35  0-100/46 0-100/25 0-100/0  -      0-100/59
 t7  0-90/64  0-100/0  0-100/12 0-100/32 -      0-100/58
 t8  0-90/59  0-100/0  0-100/17 0-100/0  -      0-100/44
 t9  0-90/63  0-100/18 0-100/21 0-100/23 -      0-100/43
 t10 1-100/13 0-100/31 0-100/26 0-100/0  0-1/0  0-100/28   GATE
amp (A and B): slots 0-6 0-100, slot 7 (NR SENS) 0-50; defaults in the table 100,80,50,50,50,100,50,0 (unused by code)
```

## 5. Program name (bytes 0-7)

- The name edit control (dialog 1001, id 0x5A) has style 0x50000088 = `ES_UPPERCASE | ES_AUTOHSCROLL`,
  so Windows converts typed lowercase to uppercase.
- On every EN_UPDATE (`HandleMainPanelCommand` 0x40561e) the editor deletes any char < 0x20 or > 0x5F
  and puts the caret back. The allowed set is therefore exactly ASCII 0x20-0x5F (space `!"#$%&'()*+,-./0-9:;<=>?@A-Z[\]^_`).
  Characters such as `` ` { | } ~ `` and non-ASCII are removed, not mapped.
- The first 8 chars are used. Short names are padded with spaces (0x20), and each of the 8 bytes is
  sent as its own parameter change (param 00,00..00,07), but only for bytes that changed.
- On display (`0x401803`), trailing spaces are trimmed. Bytes 8-9 are not part of the name: they are
  never read or written by the name code, and the PDF lists them as reserved.
- The "strings" at 0x420c90 / 0x420cec / 0x420d6a are **not** character tables. Ghidra merged them
  out of four 101-byte value-rescaling curves (0x420c18, 0x420c7d, 0x420ce2, 0x420d47). These curves
  are used only by `ConvertToneLabProgramToSE` (0x40c7d3) when importing files from the original
  ToneLab (file version 0x2540; message "ToneLabSE SoundEditor converts ToneLab's data files.").
  Type-remap bytes for that import are at 0x420bf4 (pedal), 0x420bff (mod), 0x420c05 (delay),
  0x420c09 (reverb) and 0x420c0d (cab). None of this is needed for a ToneLab SE-only editor.

## Bit / control-id map (confirms the PDF)
Byte 10: b0 PEDAL (ctl 0xA1), b1 MOD (0xA8), b2 DELAY (0xA9), b3 REVERB (0xAA), b4 AMP A (0xA2),
b5 CAB A (0xA3), b6 AMP B (0xA6), b7 CAB B (0xA7). Byte 11: b0 INSERT (0xA0), b1 A/B (0xA5; 0xA4 is
the "A" radio button, not stored). Byte 77/82/87 values are masked with 0x3F (bits 6-7 reserved).
