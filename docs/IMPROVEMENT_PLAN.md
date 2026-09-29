# Ride The Lost Sierra improvement plan

## Outcome

Brian should be able to add a route, edit its content, and share the guide without repeatedly correcting presentation and data plumbing. Preserve the current brand, watercolor terrain, reusable ride viewer, account-free public experience, and saved editorial/camera work.

## Workstreams

1. **Public experience — Sol:** fix reproducible navigation races, loading/error states, card sizing, and mobile controls. Preserve the established playback and transition behavior.
2. **Editorial workflow — Sol:** make common settings explicit in the CMS, including map-label controls; validate data and preserve unsaved edits and existing route settings.
3. **Import quality — Sol:** provide safe repeatable GPX staging, focused surface rebuilds, and a content audit. Avoid overwriting live CMS edits or unrelated routes.
4. **Integration — lead:** review every change; fix cross-cutting regressions; test the full application and representative browser flows; commit and push the integrated result.

## Acceptance checks

- Public navigation: overview → ride → family option → overview, including rapid changes and browser history.
- Ride interaction: profile scrubbing, Play/Pause, camera return, shared home, endpoint links.
- Layout: desktop and narrow mobile cards, expanded notes, route dropdown, Loop/Shuttle.
- CMS: existing values load accurately; validation helps before submission; canceled/failed saves retain work.
- Content: coordinate/elevation validity, terrain coverage, surface hash and range coverage, missing editorial fields.
- Preservation: no source geometry or live CMS field changes without an explicit reason; backup before live schema/data work.
- Regression gate: full server tests, frontend build, TypeScript check, and browser review.

## Scope boundaries

Keep the existing visual direction. Do not invent trail access rules, conditions, intensity, or parking certainty. Missing content should be reported in the admin workflow. No deployment, public accounts, new hosting, or external outreach in this pass.

## Follow-through

The integration report records what shipped, validation evidence, and any remaining content decisions. A checked-in CI gate should prevent known automated regressions from reaching the main branch unnoticed. Route creation remains repeatable through documented commands and explicit reviewable staged output.

## First pass delivered

- **Public experience:** cancel superseded track requests, prevent stale return transitions from replacing a newly selected ride, distinguish failed loads from absent GPS, and offer retry. Improve touch targets, keyboard focus, and expanded-note scrolling.
- **Camera framing:** automatically fit unconfigured rides into the area beside/above the card; measure the final ride layout before fitting. Preserve all saved home views and the established flight planner.
- **CMS:** select nearby road/waterway labels with name chips, paste parking coordinates, select an existing route family, search family/option names, and reopen the last edited entry. Keep unsupported flag details when editing supported fields.
- **Imports:** stage GPX files as reviewable drafts; reject invalid coordinates, elevation mixtures, large gaps, and duplicate IDs. Preserve recorded elevation and provenance. Rebuild one ride's surfaces without replacing other classifications.
- **Quality:** audit effective versioned seeds, terrain bounds/binary size, and surface hashes/ranges. GitHub Actions runs tests, this structural audit, TypeScript, and the production build.
- **Payload:** reuse Lake Davis's existing terrain water geometry instead of bundling a duplicate shoreline file in JavaScript; the main bundle fell from about 875 KB to 709 KB before gzip.

## Integration evidence

- 53 automated tests pass, including authenticated publishing, edit conflicts, shared homes, imports, route surfaces, camera framing, and geometry preservation.
- Production build and TypeScript check pass.
- Browser review: Jamison desktop and 390 × 844 mobile framing, Play/Pause, return to overview, Downieville family switching plus rapid history navigation, Buzzards Loop/Shuttle, expanded notes, overview water, and CMS label selection.
- Live CMS content was not rewritten. A SQLite backup was created before restarting the server; the CMS label-selection check was unsaved, and the stored record's version/settings were verified unchanged.
- Curated seed audit: 17 rides, zero structural errors, 24 editorial review items. Those warnings describe versioned seeds, not the latest CMS edits.

## Next priorities

1. **Complete the catalog:** inspect live CMS records, fill missing GPS routes from authorized sources, confirm parking and effort from available evidence, and clearly distinguish unresolved content. Never replace current notes or homes with seed values.
2. **Make route preparation more visual:** bring surface range editing and import review into the CMS, with profile selection, preview, and version-checked saves. This removes repeated code edits for mile-by-mile corrections.
3. **Expand interaction coverage:** automate representative browser flows, including network failure, rapid navigation, mobile orientation changes, saved-home behavior across viewport sizes, and flag link activation.
4. **Prepare real hosting:** select the host with Brian, then add persistent SQLite storage, off-machine backup/restore verification, HTTPS configuration, and operational monitoring before deployment.

The working rule for subsequent changes is: implement, inspect the actual browser result, fix issues found during review, then commit and push. Brian should review product decisions rather than act as the regression tester.
