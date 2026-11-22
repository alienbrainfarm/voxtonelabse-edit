# Security hardening

Implement the MIDI validation and Electron trust-boundary fixes requested after the security review. Ship them through a pull request as release 1.0.1.

## Approach

Reject malformed MIDI at the codec boundary, and validate effect types before mutating program state. Preserve valid simulator and hardware message formats. Limit Electron permission grants to the exact packaged editor in its intended top-level window, deny navigation away from that document and embedded frames, and apply a restrictive Content Security Policy. Keep browser and desktop file import/export working.

Boundary validation is preferable to scattered UI catches because invalid messages must never satisfy pending requests. Electron restrictions are preferable to relying on the absence of links or injection bugs.

## Delivery

Use a feature branch and PR. Require CI and resolved conversations on main, apply protection to administrators, and forbid force pushes and deletion. Do not require a second human reviewer for this personal repository. Publish v1.0.1 from the merged commit only after checks and platform builds succeed. Verify release assets and protections.

## Constraints

No new runtime dependencies; preserve Web MIDI/SysEx support, simulator operation, and local .TLP/.TLG import/export. Test malformed/oversized/truncated MIDI, effect index boundaries, frame/window/origin permissions, navigation, and browser startup under CSP. Existing factory-preset tests may skip when proprietary fixtures are absent.
