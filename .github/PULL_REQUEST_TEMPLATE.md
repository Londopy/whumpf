## What and why

<!-- What changes, and what problem it solves. -->

## Related issues

<!-- Closes #123 -->

## Checklist

- [ ] `pytest` passes
- [ ] `ruff check .` clean
- [ ] `cargo test` passes (if the Rust crate changed)
- [ ] Tests added for changes to the packed encoding, bulletin normalizer, or
      band resolution

## Safety surfaces

- [ ] No attribution, expiry, staleness, or disclaimer surface was removed,
      hidden, or weakened
- [ ] No forecast data is generated, interpolated, or modified
- [ ] No elevation band breakpoints or aspect sets were hardcoded
- [ ] If `unpack()` changed, the client shaders were updated to match

<!-- If any box above is unchecked, explain here. -->
