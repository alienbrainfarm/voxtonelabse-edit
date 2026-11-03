# ToneLab SE SoundEditor: global data, file formats and ToneLab-to-SE conversion

Sources: SeTnLbSE.EXE (Ghidra addresses given), `reference/docs/tonelabse_midi.pdf` (SE MIDI implementation,
Table 1 and 2), `reference/docs/tonelab_midi1.pdf` (original ToneLab MIDI implementation), and the sample files
`extracted/cab/ToneLabSE_Preset.TLP` and `extracted/cab/ToneLab_Preset.TLP`.

## 1. Global data (16 bytes, buffer DAT_004235bc)

The layout and the parameter addresses are exactly those of SE PDF Table 2. The table below shows how the
editor maps each field to its Global tab (dialog 1013, proc FUN_0040f3a3). The UI-control to address mapping is
FUN_00409937, the send path is FUN_0040eaed -> FUN_00409a01, and the receive path is FUN_00408e8c.

| Byte | Field | UI (ctrl id) | Param (p1,p2) |
|---|---|---|---|
| 0 | MIDI channel 0..15 | static text 301, shown as value+1 (read-only) | 40,00 |
| 1 b0 | Program Change Out | checkbox 311 | 41,00 |
| 1 b1 | Control Change In & Out | checkbox 312 | 41,01 |
| 1 b2 | System Exclusive Out | checkbox 313 | 41,02 |
| 1 b4 | Hold Channel A/B | checkbox 314 | 41,04 |
| 1 b5 | Initialize Exp 1 Pedal Value | checkbox 315 | 41,05 |
| 1 b6 | Initialize Exp 2 Pedal Value | checkbox 316 | 41,06 |
| 2 | CC# EXP 1 Pedal | combo 321 | 42,00 |
| 3 | CC# EXP 2 Pedal | combo 322 | 42,01 |
| 4 | CC# CONTROL Pedal | combo 323 | 42,02 |
| 5 | CC# PEDAL On/Off | combo 324 | 42,03 |
| 6 | CC# MOD On/Off | combo 325 | 42,04 |
| 7 | CC# DELAY On/Off | combo 326 | 42,05 |
| 8 | CC# REVERB On/Off | combo 327 | 42,06 |
| 9 | CC# INSERT On/Off | combo 328 | 42,07 |
| 10 | CC# A/B Ch On/Off | combo 329 | 42,08 |
| 11..14 | reserved (not shown or touched by the editor) | | |
| 15 | Output Select | combo 331: index 0 "Amp", 1 "Line" (strings at 0x42113B) | 43,01 |

- **CC combos.** Index 0 is "OFF" (0x421144). Indices 1..96 are "CC00".."CC95" (format "CC%02d", 0x421148).
  The combo index is used directly as the stored and transmitted value: `0` = Off, `v` = CC number `v-1`.
  This matches the PDF's "00,1~60: Off, CC00~CC95".
- **Display.** The Global tab also shows "Target : VOX ToneLabSE" (control 341) and "Version : M.mm" (342),
  both taken from the identity reply (see protocol.md section 2). Before a reply arrives, both are blank.
- **Sending a change.** Changing a checkbox or combo updates the buffer and sends
  `F0 42 3n 6D 08 41 p1 p2 00 vv F7` immediately. Bit fields are sent as the single bit value.
- Incoming `41 43 01 vv` stores `vv & 1` into byte 15. Incoming `41 41 03 ..` (reserved bit 3) is ignored.

## 2. File container (.TLP and .TLG), WriteTlpTlgFile (0x0040bfd7) and ReadTlpTlgFile (0x0040ce20)

Every file starts with a 32-byte header, followed by data sections. All values are little-endian.

| Offset | Size | Meaning |
|---|---|---|
| 0x00 | u32 | File type. **0x00002550** (`50 25 00 00`) = ToneLab SE; **0x00002540** (`40 25 00 00`) = original ToneLab. Written as `'P','%',0,0`. |
| 0x04 | 4 | 0 |
| 0x08 | u32 | Alternative type field: used by the reader only when the dword at 0x00 is 0 (FUN_0040cdd7). Purpose unknown (inferred legacy); the writer leaves it 0. |
| 0x0C | 4 | 0 |
| 0x10 | u24 + u8 | **Program section**: 24-bit file offset (LE) + count. `20 00 00 60` = offset 0x20, 96 programs. All zero = no programs. |
| 0x14 | u24 + u8 | **Global section**: 24-bit file offset + count (count is 1). All zero = no global. |
| 0x18 | 8 | 0 |

The program section holds `count` x 92-byte programs in the dump order of PDF Table 1. The global section holds
`count` x 16 bytes.

### What the editor writes (WriteTlpTlgFile)

Header fields are filled with FUN_0040bfa6. The editor writes three kinds of file:

- **.TLP (program set)**, from Save/Save As of the current document (FUN_0040c0de) when the extension is not
  "TLG". It contains 96 programs at 0x20, header `50 25 00 00 | 0... | 20 00 00 60 | 00 00 00 00 | 0...`, and
  no global section. The file is 8864 bytes.
- **.TLG (global)**, from FUN_0040c0de when the extension is "TLG" (compared on 3 characters with
  FUN_00410b74). It has no programs. The global is at 0x20 and the header is
  `50 25 00 00 | 0... | 00 00 00 00 | 20 00 00 01`. The file is 48 bytes.
- **Single-program export (File > Export..., FUN_0040d76f)**. The user picks the program in dialog 1041
  ("Target Program"). The default file name is the program name with trailing spaces removed and
  `/ : ; . * " < > ? \` replaced by `_` (FUN_0040d686). The format is the same as a .TLP with count 1:
  header `50 25 00 00 ... | 20 00 00 01 | 00 00 00 00`, then one 92-byte program. The file is 124 bytes and
  uses the extension .TLP. The program is taken from the current document.

A program section and a global section can both be present. When they are, the global offset is
`0x20 + 92*count`. The editor never writes such a file, but the reader accepts it.

### How the editor reads files (ReadTlpTlgFile, mode 0 = open/import, mode 1 = import preview)

1. The 32-byte header is read and its type is checked.
   - In mode 0, a type other than 0x2550 or 0x2540 gives "Error: Invalid data file format".
   - In mode 1, an unknown type makes ConvertToneLabProgramToSE return an error.
2. **Global section** (mode 0 only, when its offset and count are non-zero):
   - Type 0x2550: the editor reads 16 bytes into the global buffer, then **overwrites byte 0 with the
     editor's current MIDI channel**, so loading a .TLG never changes the device channel.
   - Type 0x2540: the editor shows "Error: ToneLabSE SoundEditor can read a native Global data only." Original
     ToneLab globals are never converted; their layout differs (see the original PDF Table 2).
3. **Program section** (when its offset and count are non-zero; count is clamped to 96):
   - For type 0x2540 the editor first shows "ToneLabSE SoundEditor converts ToneLab's data files.".
   - Each 92-byte record is read and passed to **ConvertToneLabProgramToSE (0x0040c7d3)**. Type 0x2550
     records are kept unchanged; type 0x2540 records are converted in place (section 3).
   - **Open** (File > Open, FUN_0040d306, extension "TLP"): the programs fill a new document bank. At most 3
     documents can be open, and opening a fourth gives "Can't open any more Program files.".
   - **Open with extension "TLG"**: the global is loaded, the Global tab is shown, and **a `51` global dump is
     queued to the device at once** (QueueDumpTransmit(0x61)).
   - **Import** (File > Import..., FUN_0040dd96): the file dialog shows a preview (dialog 1005). Programs are
     read into the preview bank DAT_00423628 in mode 1. A red " ToneLab's data " label appears when the file
     type is 0x2540, and "Audition" sends the previewed program as a `40` dump. On OK the file is read again in
     mode 0 with DAT_004235b8 = 1:
     1. The "Import Program / Paste to:" dialog (1042) chooses the destination slot.
     2. The editor seeks to the chosen source program (`DAT_004235b4 * 92`, relative to the program section)
        and reads one program.
     3. The program is converted if needed, stored and transmitted (see protocol.md section 7).
4. File association: the editor registers the classes `TLPfile` and `TLGfile` (FUN_00407102). The
   open-dialog filters list *.TLP and *.TLG; filter string 2000 also lists *.TL, but the opener rejects any
   extension other than TLP or TLG.

Sample checks:

- `ToneLabSE_Preset.TLP` starts with `50 25 00 00` and its header has `20 00 00 60` at 0x10.
- `ToneLab_Preset.TLP` starts with `40 25 00 00` and also has `20 00 00 60` at 0x10.
- Both files are 8864 bytes.

## 3. ToneLab (original) program to ToneLab SE program (ConvertToneLabProgramToSE, 0x0040c7d3)

The source is a 92-byte original-ToneLab program (original PDF Table 1). The output starts as 92 zero bytes;
fields not listed below stay 0. In particular, these output bytes are always zero:

- bytes 8 and 9 (reserved in the SE layout);
- byte 11 (INSERT off, A/B = A);
- byte 12 (chain 0 = M-D-R);
- unused knob slots and the reserved bytes;
- bytes 89..91.

This section was read from the disassembly. The 101-entry tables were read from DATA. The defaults used for
"OFF" source types come from the editor's per-type knob tables `(min, max, default)` (12 bytes per type, for
example table 0x4193B0 for delay time). The numeric results are given inline.

### 3.1 Type maps (DATA 0x420BF4..0x420C17)

| Section | Original value -> SE value |
|---|---|
| Pedal (byte 13) | 0 OFF -> *special*, 1 COMP -> 0 COMP, 2 ACOUSTIC -> 1 ACOUSTIC, 3 VOX WAH -> 2 VOX WAH, 4 AUTO WAH -> 3 AUTO WAH, 5 U-VIBE -> 4 U-VIBE, 6 OCTAVE -> 6 OCTAVE, 7 TREBLE BOOST -> 8 TREBLE BOOST, 8 TUBE OD -> 9 TUBE OD, 9 FAT OD -> 12 FAT DIST, 10 FUZZ -> 14 FUZZ |
| Modulation (byte 22) | 0 OFF -> *special*, 1 CHORUS -> 1 STEREO CHORUS, 2 FLANGER -> 2 CLASSIC FLANGER, 3 PHASER -> 4 DUO PHASE, 4 TREMOLO -> 5 TEXTREM, 5 ROTARY -> 6 ROTARY |
| Delay (byte 31) | 0 OFF -> *special*, 1 DELAY -> 5 STEREO DELAY, 2 TAPE ECHO -> 0 ECHO PLUS, 3 MULTI HEAD -> 1 MULTI HEAD |
| Reverb (byte 40) | 0 OFF -> *special*, 1 SPRING -> 1 SPRING 2, 2 ROOM -> 7 ROOM 2, 3 PLATE -> 3 PLATE 2 |
| Cabinet (byte 58) | 0..9 -> value+1 (TWEED 1x12 .. US V30 4x12; the SE list has TWEED 1x8 inserted at 0), 10 OFF -> 7 (VOX AD412) with the cabinet on-bits cleared |

The effect on/off bits (byte 10 b0..b3) are copied unchanged. A source "OFF" type therefore becomes a real SE
type with default knob values, and its effect stays switched off only if the source on-bit was 0. Original
programs always store OFF types with the on-bit clear (inferred).

### 3.2 Field mapping (s = source byte, o = output byte)

```
o[0..7]  = s[0..7]                       name
o[10]    = s[10] | 0x10 | 0x40           AMP A on, AMP B on
           | 0x20 | 0x80 if s[58] != 10  CAB A on, CAB B on (only if source cab is not OFF)

PEDAL  o[13] = map(s[13])
  SE 0 COMP, 4 U-VIBE : o14=s14, o15=s16, o16=s15
  SE 3 AUTO WAH       : o14=s14, o15=s16, o16=s15, o18=0, o19=0
  SE 1 ACOUSTIC, 6 OCTAVE : o14=s15, o15=s14, o16=s16
  SE 2 VOX WAH        : o15=s14 (CLOSE), o16=s16 (OPEN), o17=SCALE_0_90[s15] (PEDAL->MANUAL), o18=0 (TYPE V847), o19=0 (PRE)
  SE 8 TREBLE BOOST   : o14=s14, o16=s15, o15=LEVEL_TREBLE_BOOST[s16]
  SE 9 TUBE OD, 12 FAT DIST : o14=s14 (DRIVE), o16=s15 (TONE), o15=s16 (LEVEL)
  SE 14 FUZZ          : o14=s14, o16=s15, o15=LEVEL_FUZZ[s16]
  source OFF          : o13=0 (COMP), o14=19, o15=54, o16=19          (COMP defaults)

MODULATION  o[22] = map(s[22])
  SE 1 STEREO CHORUS  : o23=s23 SPEED, o24=s25 DEPTH, o26=s26 MANUAL, o28=s24 MIX
  SE 2 CLASSIC FLANGER: o23=s23, o24=s25 DEPTH, o25=s24 RESO, o26=s26 MANUAL, o27=0 OFFSET(default), o28=s27 MIX
  SE 4 DUO PHASE      : o23=s23 SPEED1, o24=s25 DEPTH, o25=s24 RESO, o26=20 SPEED2(default), o27=3 MODE(P2)
  SE 5 TEXTREM        : o23=s23 SPEED, o24=s25 DEPTH, o27=s24 SPREAD
  SE 6 ROTARY         : o23=s23 SPEED1, o24=s25 DEPTH, o26=99 SPEED2(default), o27=s24 ACCEL(<-TIME)
  source OFF          : o22=1, o23=18, o24=31, o26=34, o28=40          (STEREO CHORUS defaults)

DELAY  o[31] = map(s[31]); time o32..33 is 16-bit big-endian
  all mapped types    : o32,o33=s32,s33 TIME, o34=s35 FEEDBACK, o38=s34 MIX
  SE 0 ECHO PLUS      : o35=s36 TONE, o37=19 LO DAMP(default); TIME clamped to 26..2000
  SE 1 MULTI HEAD     : o35=s36 TONE, o37=s37 MODE;            TIME clamped to 1..2000
  SE 5 STEREO DELAY   : o35=0x5A TONE(10.0), o36=0 DUCKING;    TIME clamped to 1..4000
  source OFF          : o31=5, TIME=756 (o32=0x02,o33=0xF4), o34=44, o35=69, o36=0, o38=68

REVERB  o[40] = map(s[40])
  all mapped types    : o42=s41 LO DAMP, o43=s43 HI DAMP, o46=s42 MIX
  SE 1 SPRING 2       : o41=50 TIME, o44=0 PRE DLY   (defaults)
  SE 7 ROOM 2         : o41=64,      o44=32
  SE 3 PLATE 2        : o41=42,      o44=46
  source OFF          : o40=1, o41=50, o42=16, o43=26, o44=0, o46=42

AMP / CAB (A ch)
  o[49..54] = s[49..54]                  AMP type, GAIN, VR GAIN, TREBLE, MIDDLE, BASS
  o[55] = CH_VOLUME[s[8]]                original program CH VOLUME (byte 8) -> SE CH VOLUME (curve)
  o[56] = s[55]                          PRESENCE
  o[57] = s[9]                           original program NR SENS (byte 9) -> SE NR SENS
  o[58] = cabmap(s[58])
B ch: o[63..76] = o[49..62]              B channel is an exact copy of A

EXP PEDAL 1  (original byte 77 b3..b5 = 0 none,1 PDL,2 MOD,3 DLY input,4 REV input)
  e = s[77]; o[77] = 0; o[78..81] = s[78..81]
  e>>3 == 1 (PDL): if SE pedal == 2 VOX WAH -> o77=e (0x08 P/MANUAL),
                       o79=SCALE_0_90[s79], o81=SCALE_0_90[s81]  (low bytes only)
                   if SE pedal == 4 U-VIBE  -> o77=e (P/SPEED)
                   else none
  e>>3 == 2 (MOD): SE mod 1,4,5,6 -> o77=e (M/SPEED or M/SPEED1); SE mod 2 -> o77=e+3 (M/MANUAL); else none
  e>>3 == 3 or 4 : o77=e (0x18 D/INPUT, 0x20 R/INPUT)
  if o77 == 0: o78=0, o79=0, o80=0, o81=100       (range 0..100)
EXP PEDAL 2 : o82=1 (VOLUME), o83..84 = 0, o85..86 = 0x0064   (min 0, max 100)
CONTROL     : o87=8 (DLY TAP), o88=6 (factor 1)
```

### 3.3 Value tables (101 entries, indexed by the source value 0..100)

```
LEVEL_TREBLE_BOOST (0x420C18) = [0,1,1,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,5,6,6,6,6,7,7,7,7,8,8,8,8,9,9,9,9,10,10,10,10,10,11,11,11,11,12,12,12,12,13,13,13,13,14,14,14,14,15,15,15,15,15,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,20,21,21,21,21,22,22,22,22,23,23,23,23,24,24]
LEVEL_FUZZ (0x420C7D)         = [0,2,3,5,7,9,10,12,14,16,17,19,21,22,24,26,28,29,31,33,34,36,38,40,41,43,45,47,48,50,52,53,55,57,59,60,62,64,66,67,69,71,72,74,76,78,79,81,83,84,86,88,90,91,93,95,97,98,100] + [100]*42
CH_VOLUME (0x420CE2)          = [0,1,14,17,20,22,24,26,28,30,32,33,35,36,37,39,40,41,42,44,45,46,47,48,49,50,51,52,53,54,55,56,57,57,58,59,60,61,62,62,63,64,65,66,66,67,68,69,69,70,71,71,72,73,73,74,75,75,76,77,77,78,79,79,80,81,81,82,82,83,84,84,85,85,86,87,87,88,88,89,89,90,91,91,92,92,93,93,94,94,95,95,96,96,97,97,98,98,99,99,100]
SCALE_0_90 (0x420D47)         = [0,1,2,3,4,5,5,6,7,8,9,10,11,12,13,14,14,15,16,17,18,19,20,21,22,23,23,24,25,26,27,28,29,30,31,32,32,33,34,35,36,37,38,39,40,41,41,42,43,44,45,46,47,48,49,50,50,51,52,53,54,55,56,57,58,59,59,60,61,62,63,64,65,66,67,68,68,69,70,71,72,73,74,75,76,77,77,78,79,80,81,82,83,84,85,86,86,87,88,89,90]
```

The editor does not range-check source bytes before indexing these tables. A reimplementation should clamp
the index to 0..100.

### 3.4 Reference implementation (Python, checked against all 96 programs of ToneLab_Preset.TLP)

The checks were that the code runs on all 96 programs and that the outputs are plausible. It was not compared
byte-for-byte with output from the original editor.

```python
PEDAL_TYPE  = [None, 0, 1, 2, 3, 4, 6, 8, 9, 12, 14]
MOD_TYPE    = [None, 1, 2, 4, 5, 6]
DELAY_TYPE  = [None, 5, 0, 1]
REVERB_TYPE = [None, 1, 7, 3]
CAB_TYPE    = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 7]
DELAY_TIME_RANGE = {0: (26, 2000), 1: (1, 2000), 5: (1, 4000)}

def tl_to_se(s):                      # s: 92-byte original ToneLab program -> 92-byte SE program
    o = bytearray(92)
    o[0:8] = s[0:8]
    o[10] = s[10]
    t = PEDAL_TYPE[s[13]] if s[13] < len(PEDAL_TYPE) else None
    if t is None:
        o[13] = 0; o[14], o[15], o[16] = 19, 54, 19
    else:
        o[13] = t
        if t in (0, 3, 4):
            if t == 3: o[18] = o[19] = 0
            o[14], o[15], o[16] = s[14], s[16], s[15]
        elif t in (1, 6):  o[14], o[15], o[16] = s[15], s[14], s[16]
        elif t == 2:       o[15], o[16], o[17] = s[14], s[16], SCALE_0_90[s[15]]; o[18] = o[19] = 0
        elif t == 8:       o[14], o[16], o[15] = s[14], s[15], LEVEL_TREBLE_BOOST[s[16]]
        elif t in (9, 12): o[14], o[16], o[15] = s[14], s[15], s[16]
        elif t == 14:      o[14], o[16], o[15] = s[14], s[15], LEVEL_FUZZ[s[16]]
    t = MOD_TYPE[s[22]] if s[22] < len(MOD_TYPE) else None
    if t is None:
        o[22] = 1; o[23], o[24], o[26], o[28] = 18, 31, 34, 40
    else:
        o[22] = t
        if t == 1:   o[23], o[24], o[26], o[28] = s[23], s[25], s[26], s[24]
        elif t == 2: o[23], o[24], o[25], o[26], o[27], o[28] = s[23], s[25], s[24], s[26], 0, s[27]
        elif t == 4: o[23], o[24], o[25], o[26], o[27] = s[23], s[25], s[24], 20, 3
        elif t == 5: o[23], o[24], o[27] = s[23], s[25], s[24]
        elif t == 6: o[23], o[24], o[26], o[27] = s[23], s[25], 99, s[24]
    t = DELAY_TYPE[s[31]] if s[31] < len(DELAY_TYPE) else None
    if t is None:
        o[31] = 5; o[32], o[33] = 0x02, 0xF4; o[34], o[35], o[36], o[38] = 44, 69, 0, 68
    else:
        o[31] = t
        o[32], o[33], o[34], o[38] = s[32], s[33], s[35], s[34]
        if t == 0:   o[35], o[37] = s[36], 19
        elif t == 1: o[35], o[37] = s[36], s[37]
        elif t == 5: o[35], o[36] = 0x5A, 0
        lo, hi = DELAY_TIME_RANGE[t]
        v = min(max((o[32] << 8) | o[33], lo), hi); o[32], o[33] = v >> 8, v & 0xFF
    t = REVERB_TYPE[s[40]] if s[40] < len(REVERB_TYPE) else None
    if t is None:
        o[40] = 1; o[41], o[42], o[43], o[44], o[46] = 50, 16, 26, 0, 42
    else:
        o[40] = t
        o[41], o[44] = {1: (50, 0), 7: (64, 32), 3: (42, 46)}[t]
        o[42], o[43], o[46] = s[41], s[43], s[42]
    o[49:55] = s[49:55]
    o[55] = CH_VOLUME[s[8]]
    o[56] = s[55]
    o[57] = s[9]
    o[58] = CAB_TYPE[s[58]]
    cab_on = s[58] != 10
    o[10] |= 0x10 | (0x20 if cab_on else 0)
    o[63:77] = o[49:63]
    o[10] |= 0x40 | (0x80 if cab_on else 0)
    e = s[77]; o[77] = 0; o[78:82] = s[78:82]
    sec = e >> 3
    if sec == 1:
        if o[13] == 2:   o[77] = e; o[79] = SCALE_0_90[s[79]]; o[81] = SCALE_0_90[s[81]]
        elif o[13] == 4: o[77] = e
    elif sec == 2:
        if o[22] in (1, 4, 5, 6): o[77] = e
        elif o[22] == 2:          o[77] = e + 3
    elif sec in (3, 4):
        o[77] = e
    if o[77] == 0:
        o[78], o[79], o[80], o[81] = 0, 0, 0, 100
    o[82], o[83], o[84], o[85], o[86] = 1, 0, 0, 0, 100
    o[87], o[88] = 8, 6
    return bytes(o)
```

Example: the first preset in ToneLab_Preset.TLP converts to the following program.

```
in : 42 4c 49 5a 5a 41 52 44 22 26 0e 00 00 08 2c 3c 58 ...      "BLIZZARD", TUBE OD, CHORUS, TAPE ECHO, ROOM
out: 42 4c 49 5a 5a 41 52 44 00 00 fe 00 00 09 2c 58 3c 00 00 00 00 00 01 16 0d 00 28 00 21 00 00 00 01 b8 28
     28 00 13 28 00 07 40 1e 22 20 00 2c 00 00 08 4f 32 30 40 32 3a 25 26 08 00 00 00 00 08 4f 32 30 40 32 3a
     25 26 08 00 00 00 00 00 00 00 00 64 01 00 00 00 64 08 06 00 00 00
```

## 4. Open points

- The meaning of the alternative type dword at header offset 0x08 is unknown. No sample file uses it.
- Whether the device accepts a `50` all-data dump whose 92-byte "dummy" block is all zeros is assumed rather
  than tested. The editor always sends zeros there.
- The `.TL` extension in filter string 2000 is not handled by any code path that was found (possibly an older
  original-ToneLab single-program format).
