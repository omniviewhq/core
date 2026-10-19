# Omniview

Omniview connects file sources, format plugins, and application interfaces so
documents can be viewed and optionally edited in a host application.

## Language

**Source**:
The original file bytes and identifying metadata supplied to Omniview.
_Avoid_: Edited document, session

**Document**:
The content being viewed or edited, whose structure depends on its format.
_Avoid_: Source, viewer instance

**Session**:
One document's interaction lifetime, including its current state and available
viewing or editing capabilities. Separate sessions have independent state.
_Avoid_: Tab, viewer instance, plugin

**Format plugin**:
An implementation that understands a file format and supplies document
capabilities for it. Each opened document has its own plugin session.
_Avoid_: Framework adapter, renderer, theme

**Capability**:
A supported document operation or feature, such as editing, search, or zoom.
Availability can differ between documents opened by the same format plugin.
_Avoid_: Mode, configuration option

**Renderer**:
An interface that presents session state and connects user interactions to its
commands. Several visual presentations can use the same document behavior.
_Avoid_: Format parser, core

**Framework adapter**:
An integration that connects Omniview to a framework's component and lifecycle
conventions.
_Avoid_: Format plugin

**Serialization**:
Producing output bytes representing a particular document revision.
_Avoid_: Persistence, successful save

**Persistence**:
Successfully writing serialized output to the application's chosen destination.
_Avoid_: Serialization, export
