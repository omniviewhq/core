# Customization and style isolation

## Purpose and scope

Omniview must fit the host application's design system. Developers control all
public presentation and behavior without forking the product. This document
defines the architecture policy for future UI, plugins, and framework adapters;
it does not add rendering to the existing headless core.

The core, every format plugin, and every framework adapter remain separate
repositories and packages. Official implementations must follow this contract.

## Three levels of customization

1. Ready-made UI with optional default styles. Expose documented design tokens
   for colors, typography, dimensions, spacing, borders, and motion. Each
   instance can have its own theme, and typography can inherit from the host.
2. Replaceable UI regions. Developers can replace, reorder, or omit controls,
   icons, toolbars, navigation, document surfaces, and loading/error/empty
   states through the renderer or framework adapter's public rendering hooks.
3. Fully custom UI. Public state, commands, and events let applications render
   their own interface while reusing document behavior. Built-in components
   cannot be the only way to invoke a public action or observe its state.

Use CSS for presentation and typed options for behavior. The core does not
turn individual CSS declarations into JavaScript configuration fields.
Complete replacement remains available when tokens and region overrides
cannot express the application's layout.

Default CSS is explicitly imported; importing core functionality never injects
styles. Core logic must not require a DOM, framework, stylesheet, or theme.
UI implementations provide browser and framework integration separately.

## Namespace contract

Omniview-authored UI must use the following public namespaces:

| Surface | Convention | Example |
| --- | --- | --- |
| CSS classes | `omniview-*` | `.omniview-toolbar` |
| CSS custom properties | `--omniview-*` | `--omniview-color-background` |
| DOM data attributes | `data-omniview-*` | `data-omniview-state="loading"` |
| Keyframes | `omniview-*` | `omniview-loading-spin` |
| Cascade layers | `omniview` or `omniview.*` | `omniview.components` |
| Generated DOM/SVG IDs | `omniview-<instance>-*` | `omniview-a1-title` |

Other named stylesheet resources, including custom font families and counters,
must use the same namespace. Generated instance identifiers must be unique
within the document, including across plugins and multiple viewers.

Generic public names such as `.button`, `.toolbar`, `.active`, `--primary`, or
`@keyframes spin` are forbidden in shipped styles. A consumer may supply its own
classes; the restriction applies to names authored and shipped by Omniview.

Plugins extend the namespace with a stable plugin key: for example,
`.omniview-text-toolbar` and `--omniview-text-line-height`. Third-party plugins
include a publisher key when needed to avoid collisions with other plugins.

## Scope and cascade

All default selectors are anchored to `[data-omniview-root]`, including selectors
for component roots themselves. Internal element selectors are allowed only
inside that scope. Do not ship document-wide resets or rules targeting the
host's `html`, `body`, `:root`, bare elements, or unscoped universal selectors.

Overlays and portals receive an Omniview root marker and the originating
instance's theme values even when mounted outside the main viewer container.
Their mount target must be configurable by the host.

Keep selector specificity low, use the namespaced cascade layer, and avoid
`!important` in default styles. Class names, data attributes, and tokens used as
customization hooks are documented public API. Host styles can intentionally
cascade through these hooks; each instance's settings must remain independent.

## Behavior and accessibility

Public behavior includes available actions, editing mode, persistence hooks,
zoom, localization, and keyboard bindings. Applications must be able to control
these through options or state/command APIs, according to the capability a
plugin provides. Unsupported capabilities are represented explicitly.

Custom controls reuse the same commands as default controls. For example, a
host toolbar can save an editable document without mounting Omniview's toolbar.
Existing session ownership remains unchanged: the plugin serializes changes,
the host persists them and disposes the session.

UI primitives and rendering hooks must expose the state and accessibility
attributes needed to preserve keyboard operation, focus behavior, and semantics
when the visual implementation is replaced. Customization APIs must cover
official format-specific UI as well as shared viewer controls.

## Verification criteria for UI implementations

- A host page containing `.button`, `.toolbar`, and `.active` receives no style
  changes from loading or mounting Omniview.
- Every shipped selector and named CSS resource satisfies the namespace and
  scope rules, including overlay roots and plugin-specific resources.
- Two viewers with different themes, behavior settings, and generated IDs can
  coexist without affecting each other or an unrelated host component.
- Token overrides, replacement regions, custom controls, and fully custom UI
  reuse the same document commands and state without duplicating core logic.
- Custom UI can retain focus, keyboard navigation, and accessibility semantics.
- Headless usage does not import CSS or require browser globals.

These criteria accompany future UI implementation tests; no UI exists in the
current foundation to test or restyle yet.
