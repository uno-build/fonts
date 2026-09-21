# Redistributable CLI reference fixtures

The font binaries in this directory come from the Google Fonts repository at
commit `f2bd09badbc763d8757951d52deec29da27e85fb` and are distributed under the
SIL Open Font License. `OFL.txt` contains Lato's notice and
`OFL-Roboto.txt` contains Roboto's notice.

| File | Purpose | SHA-256 |
| --- | --- | --- |
| `Lato-Regular.ttf` | normal outlines, kerning, charset/glyphset files, and overlap preprocessing | `d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251` |
| `Lato-Bold.ttf` | second input in a multi-font atlas | `8a0aace75d33794eece4b28187bfc1df0bbd2888b5d8a56e01788c8d65d16be1` |
| `Roboto-Variable.ttf` | `wdth`/`wght` variable axes and named instances | `d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134` |

Source URLs are commit-pinned rather than branch-pinned:

- `ofl/lato/Lato-Regular.ttf`
- `ofl/lato/Lato-Bold.ttf`
- `ofl/roboto/Roboto[wdth,wght].ttf`

The text fixtures exercise the official file parsers independently of shell
quoting. They are project-authored and may be redistributed with this repo.
