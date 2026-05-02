## 10. Versioning and Release Semantics

### 10.1 Version String Forms
- Stable release: `vMAJOR.MINOR.PATCH+DATE.SHA`
- Development snapshot: `vMAJOR.MINOR.PATCH-dev+DATE.SHA[.dirty]`

Constraints:
- `MAJOR`, `MINOR`, and `PATCH` MUST be non-negative integers.
- Stable release tag components MUST NOT contain leading zeroes unless the component is exactly `0`.
- `DATE` MUST be UTC in the form `YYYYMMDD`.
- `SHA` MUST be a lowercase hexadecimal commit identifier normalized to exactly 12 characters.
- `dirty` MUST be appended when the working tree contains uncommitted changes at build time.
- Release tags MUST be created from a clean tree; stable release builds MUST NOT include `.dirty`.

### 10.2 Branch and Tag Rules
- Stable release tags MUST use the exact form `vMAJOR.MINOR.PATCH`.
- Stable release tags MUST NOT include a pre-release segment or build metadata.
- Stable release tags MUST be created from `main`.
- The release workflow MUST NOT publish a release for tags that do not match `vMAJOR.MINOR.PATCH`.
- The release workflow MAY start for broader tag patterns, but validation MUST happen before build, packaging, or publication.
- Tagged stable builds MUST emit `vMAJOR.MINOR.PATCH+DATE.SHA`.
- Untagged `main` builds MUST derive from the latest stable tag by incrementing the patch component and MUST emit `vMAJOR.MINOR.(PATCH+1)-dev+DATE.SHA[.dirty]`.
- `develop` builds MUST derive from the latest stable tag by incrementing the minor component and resetting patch to zero, then MUST emit `vMAJOR.(MINOR+1).0-dev+DATE.SHA[.dirty]`.
- When no stable tag exists, the baseline is `v0.0.0`.
  - Untagged `main` builds MUST emit `v0.0.1-dev+DATE.SHA[.dirty]`.
  - `develop` builds MUST emit `v0.1.0-dev+DATE.SHA[.dirty]`.
- Stable tags MUST NOT be created on `develop`.

### 10.3 .NET Assembly Metadata
- `AssemblyVersion` MUST use the numeric form `MAJOR.MINOR.PATCH.0`.
- `AssemblyFileVersion` MUST use the numeric form `MAJOR.MINOR.PATCH.0`.
- `AssemblyInformationalVersion` MUST contain the full version string defined by Section 10.1.
- Product and file metadata MUST be generated at build time instead of being manually edited for each release.
- Version metadata MUST NOT affect cursor mirroring behavior.

### 10.4 Build-Time Embedding
- The build scripts MUST resolve the version from Git metadata at build time.
- The resolved version MUST be embedded into the compiled application.
- Runtime VCS probing MUST NOT be performed by the application.
- If Git metadata cannot be read, the build MAY fall back to `v0.0.0-dev+DATE.unknown`.
- The fallback version MUST NOT append `.dirty`.
- Release packaging MUST require a valid stable tag and MUST fail before publication when no valid stable tag is present.

### 10.5 Package Naming
- Stable release packages MUST use the package version `MAJOR.MINOR.PATCH`.
- Development packages SHOULD use the package version `MAJOR.MINOR.PATCH-dev.DATE.SHA[.dirty]`.
- Package naming MUST be derived from the same resolved version metadata embedded into the binary.

### 10.6 Runtime Freshness Display
- Runtime freshness checks MUST compare the embedded package version with stable GitHub Release tags only.
- Stable release tags considered by the runtime checker MUST match `vMAJOR.MINOR.PATCH`.
- Draft, pre-release, malformed, or non-stable tags MUST NOT count as newer releases.
- The runtime checker SHOULD count how many stable release tags are newer than the embedded stable package version.
- The runtime checker MUST treat development package versions as development builds rather than claiming they are stable up to date.
- Freshness checks MUST be best-effort and MUST fall back to an unknown status when the network request or response parsing fails.
- Freshness checks MUST NOT affect cursor mirroring, application startup, or release metadata embedded at build time.

### 10.7 Informative Examples
- Tagged `main` release: `v1.2.3+20260430.abcdef123456`
- Untagged `main` build after `v1.2.3`: `v1.2.4-dev+20260430.abcdef123456`
- `develop` build after `v1.2.3`: `v1.3.0-dev+20260430.abcdef123456`
- Dirty `develop` build after `v1.2.3`: `v1.3.0-dev+20260430.abcdef123456.dirty`
