# ToneLab SE SoundEditor: MIDI behaviour (as implemented by SeTnLbSE.EXE)

Message formats (headers, function codes, payload sizes, the 7-bit packing, inquiry reply and the global
table) are in the official Korg document `reference/docs/tonelabse_midi.pdf`, which this file does not repeat.
This file describes what the 2004 editor does with those messages: the connection sequence, request and
transmit queues, timeouts, ACK handling and echo suppression. Addresses are Ghidra addresses in SeTnLbSE.EXE.
Functions I renamed in Ghidra are given by name, and the original FUN_ address is listed alongside.

Notation: `n` = device MIDI channel 0..15 (the editor's copy is DAT_00420ad8), `nn` = program 0..95.
`SYSEX(f, ...)` = `F0 42 3n 6D 08 f ... F7`.

## 1. MIDI ports and threads

- MIDI IN is opened with `CALLBACK_WINDOW` on the main window (FUN_004083cd, `midiInOpen(...,0x10000)`). Eight
  16 KB (0x4000) long-message buffers are prepared (FUN_00407af6 allocates them, FUN_00408322 queues them).
  The main WndProc FUN_00410346 handles only `MM_MIM_LONGDATA` (0x3C4) and passes each buffer to
  **HandleMidiInLongData (0x00408fc3)**. The buffer is requeued afterwards (FUN_00407aa0).
- **The editor ignores short messages** (MIM_DATA 0x3C3 is not handled), so incoming Program Change (Cn) and
  Control Change (Bn) are discarded. All device to editor sync relies on SysEx, which is why the device's
  "MIDI SysEx Output" global must be on (see AutoSysExOut).
- Each received buffer is assumed to hold exactly one complete SysEx message starting at byte 0.
- Sending is synchronous. FUN_004080c7 takes the named mutex `SENDEXCL_MUTEX`, calls `midiOutLongMsg`, then
  busy-waits for `MHDR_DONE` before it returns.
- Two worker threads are created by FUN_00407a60:
  - **DumpRequestThreadProc (0x00409c14)** sends dump *requests* and waits for the dump that answers each one.
  - **DumpTransmitThreadProc (0x00409f12)** sends dumps and write requests and waits for the ACK of each one.

Connection state is the bit field DAT_00422b58:

| Bit | Meaning |
|---|---|
| 0x01, 0x02 | MIDI OUT is open |
| 0x10 | MIDI IN is open |
| 0x20 | The device answered the identity request |

Requests need `(flags & 0x22) == 0x22`. Transmits need bit 0x01, but the editor waits for an ACK only when
`(flags & 0x22) == 0x22`.

## 2. Accepting incoming SysEx

- **Identity reply** (HandleIdentityReply, 0x004088dd, called first for every buffer). The handler scans the
  buffer for `F0 7E`. At offset +3 it requires the 7 bytes `06 02 42 6D 00 08 00` (DAT_0042083c). Byte +2 (the
  device ID) is **taken as the MIDI channel**: `DAT_00420ad8 = byte[+2]`. Byte +10 is stored as the minor
  version and byte +12 as the major version. The Global tab then shows `Target: VOX ToneLabSE` and
  `Version: <major>.<minor %02d>` (FUN_0040ed10, format string "%d.%02d"). For example, the reply
  `F0 7E 00 06 02 42 6D 00 08 00 00 00 01 00 F7` displays "1.00". The About box uses the same two values in
  "VOX ToneLabSE  System Version %d.%02d" (FUN_00401580).
- **Korg messages** (FUN_00408f78). The editor requires `F0 42 (30+n) 6D 08`, where n is the channel learned
  from the identity reply, and reads the function code from byte 5. Messages on any other channel or with any
  other model ID are ignored.
- **Unpacking** (FUN_004084b4). Standard Korg 8-to-7 unpacking. It then checks that the byte after the expected
  payload is `F7`. If it is not, the editor shows "Receive Error: Data size is not correct" and drops the data.
- While the identity reply is still pending (DAT_004227b4 = 1), every other incoming SysEx is dropped.

## 3. Startup / connection sequence

1. FUN_004106ac opens MIDI IN, then MIDI OUT. It calls FUN_0040173b(1), which runs
   **SendIdentityRequest (0x00408821)**:
   - If both ports are open, the editor clears the connection bits, sends `F0 7E 7F 06 01 F7` and starts a
     1000 ms timer (id 0x4D2).
   - If either port is closed, the About box reads "Dump receive is not available."
2. If the timer fires first (WM_TIMER in FUN_00410346), the editor shows "MIDI communication error occurred.
   Check the cables and MIDI interface." and continues offline.
3. When the identity reply arrives, HandleIdentityReply sets flags 0x22 and kills the timer. During startup it
   then posts About (0x38E), which acts as a splash screen and closes itself after 4500 ms. It then queues the
   following requests:
   - **First connection** (DAT_00420814 == -1, i.e. the original SysEx-Out setting is not yet known). The
     editor switches the main tab to the ToneLabSE (device) page, sets DAT_00420810 = 1 and queues:
     slot 100 (`SYSEX(12)` mode request), slot 0x60 (`SYSEX(10)` current-program request) and slot 0x61
     (`SYSEX(0E)` global request).
   - **Reconnect** (after the MIDI Setup dialog, FUN_0040a73a, which re-runs SendIdentityRequest): only slots
     100 and 0x60 are queued.
4. The request thread services slots in this priority order: 0x62 (all programs), 99 (all data), 100 (mode),
   then 0..0x61 in ascending order. The startup order on the wire is therefore:

   ```
   -> F0 7E 7F 06 01 F7                        identity request
   <- F0 7E 0n 06 02 42 6D 00 08 00 vv 00 VV 00 F7
   -> F0 42 3n 6D 08 12 F7                     mode request
   <- F0 42 3n 6D 08 42 0m 00 0p pp F7         mode data: selects program pp in the list
   -> F0 42 3n 6D 08 10 F7                     current program request
   <- F0 42 3n 6D 08 40 <106 bytes> F7         edit buffer
   -> F0 42 3n 6D 08 0E F7                     global request
   <- F0 42 3n 6D 08 51 <19 bytes> F7          global (first connection only; see 5.)
   [-> F0 42 3n 6D 08 41 41 02 00 01 F7]       only if AutoSysExOut is on and SysEx Out was Off
   -> F0 42 3n 6D 08 0F F7                     all data request
   <- F0 42 3n 6D 08 50 <10218 bytes> F7       96 programs + dummy + global
   ```

   Each request waits up to **5000 ms** for its answer: WaitForSingleObject(DAT_00422b2c, 5000). Answers
   signal the event through FUN_00407d6e(slot).

   On a timeout the editor shows "Receive Error: Can't receive a dump message. Please check your ToneLab. All
   other requests are cancelled." It then clears flag 0x20, so the device counts as disconnected and the dump
   menus are disabled, and it clears every queued request. A NAK (0x24) does not complete a request, so it ends
   in the same 5 s timeout.

## 4. AutoSysExOut / RetSysExOut

These are registry values under `HKLM\Software\KORG\ToneLabSE SoundEditor`, read in FUN_00407102 and written in
FUN_00407558:

| Value | Default | Preferences text |
|---|---|---|
| AutoSysExOut | 1 | "Enable SysEx-Out automatically on start" |
| RetSysExOut | 1 | "Restore the previous setting on exit" (only enabled when AutoSysExOut is on) |

The other values stored there are WarnProgChgTarget, WarnProgChgEditor, WarnIgnorePedalMes, WarnIgnoreChAB,
SaveLocation, TextColor and Folder.

- **Start.** HandleStartupGlobalDump (0x004087a3) handles the first `51` global dump. It decodes the dump
  into a temporary buffer only; the global buffer is filled later from the `50` all-data dump. It stores the
  device's **SysEx Out bit (global byte 1 bit 2)** in DAT_00420814. If AutoSysExOut is on and that bit is 0,
  the editor sends the global parameter change
  `F0 42 3n 6D 08 41 41 02 00 01 F7` (param 41, sub 02, value 1) through FUN_00409a01 / FUN_00408a8c. It then
  queues slot 99 (`SYSEX(0F)` all data request).
- **Exit.** On WM_DESTROY, RestoreSysExOutOnExit (0x00408760) runs if AutoSysExOut and RetSysExOut are both on
  and the original value is known. It sends `F0 42 3n 6D 08 41 41 02 00 0v F7`, where v is the original bit
  (it re-sends 1 if the bit was already on). It then busy-waits until the transmit thread is idle
  (DAT_004227b8 == 0).
- **Muting during audition.** FUN_00408a49 is used when a program in an open *file* is selected for audition.
  If the editor's copy of SysEx Out is on, it sends `41 41 02 00 00`, then the program change
  `4E 20 nn`, then `41 41 02 00 01`. This stops the device from echoing a mode change back to the editor.
- Global parameter changes are sent synchronously and **not** queued, and the editor does not wait for their
  ACK.

## 5. What the editor does with each device message (HandleMidiInLongData, 0x00408fc3)

| Func | Action |
|---|---|
| 40 current program dump | Unpacks 92 bytes into the edit buffer (DAT_004235cc), completes request slot 0x60 and refreshes the editor UI (FUN_004086a8). |
| 4C program dump | `kind & 0x20` = 1 program: stored into program `pp` of the **currently displayed document** (device bank or open file) and completes slot pp. Otherwise all 96 programs are stored the same way and slot 0x62 is completed (FUN_004085ce). In both cases the list is refreshed. If the program received is the document's current program, the editor copies it into the edit buffer and **sends it back as a `40` current-program dump** (FUN_004047b7, case 0x21A2). |
| 50 all data | Unpacks 8940 bytes: 96 programs go into the current document, bytes 8924..8939 go into the global buffer, slot 99 is completed and the UI is refreshed (FUN_0040853a). |
| 51 global | First connection: HandleStartupGlobalDump (section 4). Otherwise the dump is stored into the global buffer (DAT_004235bc), slot 0x61 is completed and the Global tab is refreshed (FUN_004086fc). |
| 42 mode data | Completes slot 100. Byte 7 (program) selects that program in the list, or is only remembered (FUN_0040bb01) when another tab is shown. The mode bit is ignored. |
| 4E mode change (device switch) | See below. |
| 41 parameter change | See below. |
| 21 write completed | `byte7` = program. The edit buffer is copied into program `pp` of the device bank, the "modified" flag is cleared, the view switches to the device tab and the list entry is refreshed and selected. If a transmit is pending, the message also **counts as its ACK** (FUN_00407db7(0x23)). |
| 23 ACK / 24 NAK | If a transmit is pending (DAT_00420824 != -1), the message goes to FUN_00407db7 (section 6). Otherwise the echo counter is decremented. |
| 22 write error, 26 data format error | **Not handled.** The pending transmit times out after 5 s instead. |

**Device 0x4E (program changed on the pedalboard).** Messages with `byte6 & 0x10` (oo = 01, "mode change
only") are ignored. Otherwise `pp = byte7` and the editor does the following.

- If WarnProgChgTarget is on and the edit buffer differs from the stored program (FUN_0040f26c / FUN_0040ef22),
  it asks "Are you sure you want to go to another program without saving the current program?"
  - If the user cancels, the editor **reverts the device**. It sends `4E 20 <old program>` and queues a `40`
    dump of its edit buffer.
- Otherwise the editor records the time (GetTickCount), switches to the device tab and **loads program pp from
  its own mirror** of the device bank into the edit buffer (FUN_00405e69). It does **not** request a dump.
- It then applies any `41` message that arrived while the dialog was open (buffered in DAT_00422b40..48).

**Device 0x41 parameter change.**

- Global parameters (p1 40..43) are applied to the global buffer and shown in the Global tab (FUN_00408e8c).
  A change to param 40 (MIDI channel) also changes the channel the editor uses.
- Program parameters are applied to the edit buffer by FUN_00408ad0, which uses the inverse of the
  FUN_00409736 address map. Two exceptions:
  - If the warning dialog is open, the value is buffered.
  - If the echo counter is non-zero, the value is dropped (see below).
- Quirk (from the decompiler output): for `41 03 0x vv` with x = 0..3 (effect type of pedal, modulation,
  delay or reverb), the editor also sets the matching on/off bit in byte 10 to (vv != 0). This looks like a
  leftover from the original ToneLab, where type 0 was OFF. **Do not replicate it.**
- If WarnIgnorePedalMes is on, values for the parameters assigned to EXP1/EXP2 do not set the "modified" flag.
  WarnIgnoreChAB does the same for the A/B channel bit.

**Echo suppression** (DAT_00420838, FUN_00407caf):

- The counter is incremented whenever the editor sends `4E` (FUN_004089f3) or queues a `40` dump.
- It is decremented by every unsolicited 23/24 and by the ACK of a `40` dump.
- It is reset to 0 by the first incoming message received more than 99 ms after the editor's last `4E`.
- While the counter is non-zero, incoming `41` program-parameter changes are ignored on the device tab. On a
  file tab they are ignored while it is 2 or more.

## 6. Transmit queue and flow control (DumpTransmitThreadProc, 0x00409f12)

QueueDumpTransmit (0x00409d50) marks a slot and sets event DAT_00422b30. Slots are serviced in this priority
order:

| Priority | Slot | Message sent |
|---|---|---|
| 1 | 0x62 | `4C 00 00` + 8832 bytes (all programs) |
| 2 | 99 | `50` + 8940 bytes: 96 programs, then 92 zero bytes, then 16 global bytes |
| 3 | 0x65 | `11 00 pp` (write request) |
| 4 | 0..95, ascending | `4C 20 nn` + 92 bytes |
| 5 | 0x60 | `40` + 92 bytes (edit buffer) |
| 6 | 0x61 | `51` + 16 bytes |

Program data comes from the current document bank, or from the device bank when the slot value has bit 0x8000.

After each message, when the device is connected:

- The thread waits **5000 ms** for DAT_00422b34. That event is set by FUN_00407db7 when 0x23, 0x24 or 0x21
  arrives.
  - **0x23 ACK:** the slot is cleared and the next message is sent at once. There are **no delays** between
    messages.
  - **0x24 NAK:** "Transmit Error: NAK Received. Do you continue ?" (Abort/Retry/Ignore).
    - Retry resends the same message.
    - Abort clears the whole queue.
    - Ignore drops this message and continues.
  - **Timeout:** "Transmit Error: Can't receive ACK. Please check your ToneLabSE. Do you continue to send other
    dump messages ?" (Yes/No).
    - No clears the queue and flag 0x20.
- When the device is not connected (no identity reply), messages are sent back to back without waiting.

Coalescing for `40`:

- QueueDumpTransmit(0x60, p) records p+1 (DAT_00422b00). The thread copies that value to DAT_00420820 when it
  sends.
- If the user picks another program while the dump is in flight, the ACK handler re-queues one more `40`.

The "Sending data..." and "Receiving data..." boxes (dialog 1050) are shown while the queues are non-empty.

All-programs / all-data / global transmit and receive come from the MIDI menu (FUN_00410203):

| Menu | Transmits | Menu | Requests |
|---|---|---|---|
| 0x3A7 Transmit All Programs | slot 0x62 | 0x3A4 Receive All Programs | `1C 00 00`, slot 0x62 |
| 0x3A8 Transmit All Data | slot 99 | 0x3A5 Receive All Data | `0F` |
| 0x3A6 Transmit Global | slot 0x61 | 0x3A3 Receive Global | `0E` |

On a file tab, the Program Dump buttons Receive and Transmit (0xCB / 0xCC in FUN_0040f3a3) queue one
`1C 20 nn` request, or one `4C 20 nn` dump, per selected program. A transmit also copies the file programs into
the device mirror. Paste and clear on the device tab (FUN_0040e2c1 / FUN_0040e19e) queue one `4C 20 nn` per
changed program, then a `40` for the current program.

## 7. Program selection and writing

- **Select a program on the device tab** (list 0x65). The editor calls FUN_004089f3, which sends
  `F0 42 3n 6D 08 4E 20 nn F7` (oo = 10, program change only) directly, not through the queue. It then loads
  program nn from the editor's mirror into the edit buffer. No dump is requested.
- **Select a program in an open file (audition)**:
  1. FUN_00408a49 sends `4E 20 <device's current program>`, muting SysEx Out around it as described in
     section 4.
  2. The file program is copied into the edit buffer.
  3. The editor queues a `40` current-program dump of that buffer.
- **Edit a knob or switch.** The editor immediately sends one `41` parameter change (FUN_00409736 ->
  FUN_00408a8c). The change is synchronous and not queued, and the editor does not wait for an ACK.
- **"Write current program..."** (dialog 1030, FUN_0040a87f, "Destination Program"):
  1. The edit buffer is copied into program nn of the device mirror.
  2. QueueDumpTransmit(nn, 0x11) queues slot 0x65.
  3. The transmit thread sends **only** `F0 42 3n 6D 08 11 00 nn F7`. No `40` dump is sent first, because the
     editor assumes the device's edit buffer already matches its own (every edit was sent as a `41`).
  4. The thread waits up to 5 s for a reply. `21 00 nn` (write completed) acts as the ACK, and its handler
     updates the list. `22` (write error) is not handled, so a write error shows up as the "Can't receive ACK"
     timeout.

  A safe reimplementation should send `40` first and wait for `23`, then send `11` and wait for `21` or `22`
  (inferred recommendation).
- **"Update program..."** (dialog 1031, FUN_0040a8f8, file tab):
  - "Store to `<file>`" copies the edit buffer into the file's program nn.
  - "Write to ToneLabSE" copies the edit buffer into the device mirror and sends the same `11 00 nn` write as
    above.
- **Import of one program into the device bank** (ReadTlpTlgFile in import mode, section 4 of files-global.md):
  1. The editor queues `4C 20 nn`.
  2. It calls `Sleep(200)`. This is the only fixed delay in the editor.
  3. It sends `4E 20 nn` directly.
  4. If the target is a file instead of the device, the program is put into the edit buffer and a `40` is
     queued.
- **Import preview "Audition"** (FUN_0040da9a): the previewed program is sent as a `40` dump. If the global
  "Channel A/B Hold" bit (byte 1 bit 4) is on, byte 11 bit 1 (A/B) is first replaced by the device's current
  A/B state. The original edit buffer is restored and sent again as a `40` when the dialog closes.

## 8. Timeouts summary

| What | Value | Where |
|---|---|---|
| Identity reply | 1000 ms (timer 0x4D2) | SendIdentityRequest / FUN_00410346 |
| Dump answer to a request | 5000 ms, then cancel all | DumpRequestThreadProc |
| ACK / 21 after a transmitted dump or write | 5000 ms, then ask the user | DumpTransmitThreadProc |
| About / splash auto-close | 4500 ms | FUN_00401580 |
| Gap before echo counter reset | > 99 ms after the editor's last 4E | HandleMidiInLongData |
| Single-program import to device | Sleep(200) between 4C and 4E | ReadTlpTlgFile |
