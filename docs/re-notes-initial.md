# ToneLab SE SoundEditor — RE notes (initial, established facts)

Binary: extracted/cab/SeTnLbSE.EXE (Borland C++, Win32, 2004). Loaded in Ghidra (MCP) as program "SeTnLbSE.EXE"
(project folder /VoxTonelabEdit). Image base 0x400000. DATA section VA 0x418000 = file offset 0x17800
(file_off = VA - 0x400800). Python helper for raw reads: scratch va.py (b(va,n), u8, u32, cstr).

## SysEx send (FUN_004080c7)
F0 42 3n 6D 08 <func> [b6] [b7] <data> F7   (n = global MIDI ch 0-15, DAT_00420ad8)
Data < 8 bytes: sent raw & 0x7F. Data >= 8 bytes: Korg 7-bit packing (each group of 7 bytes is preceded by a
byte whose bit j = MSB of byte j).

| func | extra | data | meaning |
|---|---|---|---|
| 0x10 | - | - | current program dump request |
| 0x1C | 0x20 nn | - | program nn dump request (nn 0..95) |
| 0x1C | 00 00 | - | all programs dump request |
| 0x0E | - | - | global dump request |
| 0x0F | - | - | (slot 99 request; probably all-data dump request) |
| 0x12 | - | - | (slot 100 request; unknown, maybe mode request) |
| 0x40 | - | 92 bytes | current program dump |
| 0x4C | 0x20 nn | 92 bytes | program nn dump |
| 0x4C | 00 00 | 8832 bytes (96*92) | all programs dump |
| 0x51 | - | 16 bytes | global dump |
| 0x50 | - | 8940 bytes (96*92 + 92 pad + 16 global) | all data dump |
| 0x11 | 00 nn | - | write (store) current program to nn |
| 0x4E | 0x20 nn | - | program change to nn |
| 0x41 | - | p1 p2 vHi vLo | parameter change; v 14-bit = (vHi<<7)|vLo |
Universal inquiry also sent: F0 7E 7F 06 01 F7.

## Parameter change address (FUN_00409736): program byte offset -> (p1,p2)
0-9 -> (0,off); 10 bit b -> (2,b); 11 bit b -> (2,b+8); 12 -> (2,16); 13 -> (3,0); 14-21 -> (4,off-14);
22 -> (3,1); 23-30 -> (5,off-23); 31 -> (3,2); 32/33 (16-bit) -> (6,0); 34-39 -> (6,off-33); 40 -> (3,3);
41-48 -> (7,off-41); 49 -> (3,4); 50-57 -> (8,off-50); 58 -> (3,5); 63 -> (3,6); 64-71 -> (10,off-64);
72 -> (3,7); 77 -> (12,0); 78/79 -> (12,1); 80/81 -> (12,2); 82 -> (13,0); 83/84 -> (13,1); 85/86 -> (13,2);
87.. -> (14,off-87).
Global params (FUN_00409a01): (0x40,0)=MIDI ch; (0x41,x); (0x42,n-2); (0x43,1).

## Program layout (92 bytes), internal "param id" == byte offset
0-7 name | 8,9 always 0 | 10 on/off bitfield | 11 bits (bit1 = A/B ch?) | 12 chain (0-5) | 13 pedal type (0-15)
| 14-19 pedal knobs | 22 mod type (0-10) | 23-28 mod knobs | 31 delay type (0-10) | 32-33 delay time 16-bit BE
| 34-38 delay knobs | 40 reverb type (0-10, 10=GATE?) | 41-46 reverb knobs | 49 amp A type (0-15)
| 50-57 amp A knobs (GAIN VRGAIN TREBLE MIDDLE BASS PRESENCE CHVOL NRSENS?) | 58 cab A (0-10)
| 63 amp B | 64-71 amp B knobs | 72 cab B | 77 EXP1 target | 78-79 EXP1 min (16-bit BE) | 80-81 EXP1 max
| 82 EXP2 target | 83-84 EXP2 min | 85-86 EXP2 max | 87 CONTROL target (list idx) | 88 CONTROL factor (list idx, 6='1')
UI control-id -> offset mapping: FUN_00409412. Value get/set: FUN_0040447a / FUN_00404574.
Edit buffer: DAT_004235cc (92 bytes). Global buffer: DAT_004235bc (16 bytes).

## Name lists (DATA): per-control list table at 0x418290 + ctrlId*4
amp 0x418244 (16), cab 0x418288 (11), pedal 0x4182e4 (16), mod 0x418328 (11), delay 0x418358 (11),
reverb 0x418388 (SPRING 1..HALL 2, GATE), chain 0x4183b8 (6), control 0x4183d4 (12), factor 0x418408 (12).
Knob label bitmaps per type group: PEDAL0-8, MOD0-A, DELAY0-5,8, REV0, REVA (resources).
